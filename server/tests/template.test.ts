import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

const cfnTags = [
  { tag: "!Ref", resolve: (str: string) => ({ Ref: str }) },
  { tag: "!Sub", resolve: (str: string) => ({ "Fn::Sub": str }) },
  {
    tag: "!GetAtt",
    resolve: (str: string) => ({ "Fn::GetAtt": str.split(".") }),
  },
];

interface CfnResource {
  Type: string;
  Properties: Record<string, unknown>;
  Metadata?: Record<string, unknown>;
}

interface GsiDefinition {
  IndexName: string;
  KeySchema: Array<{ AttributeName: string; KeyType: string }>;
  Projection: { ProjectionType: string };
}

interface SamApiEvent {
  Type: string;
  Properties: { Path: string; Method: string };
}

const templatePath = new URL("../template.yaml", import.meta.url).pathname;
const template = parse(readFileSync(templatePath, "utf-8"), {
  customTags: cfnTags,
});

function resourcesOfType(type: string): [string, CfnResource][] {
  return (Object.entries(template.Resources) as [string, CfnResource][]).filter(
    ([, r]) => r.Type === type,
  );
}

describe("template.yaml", () => {
  it("has SAM transform", () => {
    expect(template.Transform).toBe("AWS::Serverless-2016-10-31");
  });

  describe("LicensesTable", () => {
    const table = template.Resources.LicensesTable;

    it("exists and is DynamoDB::Table", () => {
      expect(table.Type).toBe("AWS::DynamoDB::Table");
    });

    it("has license_id HASH key", () => {
      expect(table.Properties.KeySchema).toContainEqual({
        AttributeName: "license_id",
        KeyType: "HASH",
      });
    });

    it("uses PAY_PER_REQUEST billing", () => {
      expect(table.Properties.BillingMode).toBe("PAY_PER_REQUEST");
    });
  });

  describe("GSIs", () => {
    const gsis =
      template.Resources.LicensesTable.Properties.GlobalSecondaryIndexes;

    it.each([
      "stripe_session_id-index",
      "email_hash-index",
      "stripe_charge_id-index",
    ])("has %s GSI with HASH key and ALL projection", (name) => {
      const gsi = gsis.find((g: GsiDefinition) => g.IndexName === name);
      expect(gsi).toBeDefined();
      expect(gsi.KeySchema[0].KeyType).toBe("HASH");
      expect(gsi.Projection.ProjectionType).toBe("ALL");
    });
  });

  describe("Parameters", () => {
    it.each([
      ["BaseUrl", "String"],
      ["StripePriceId", "String"],
      ["SesFromEmail", "String"],
    ])("has %s parameter of type %s", (name, type) => {
      expect(template.Parameters[name]).toBeDefined();
      expect(template.Parameters[name].Type).toBe(type);
    });

    it("SesFromEmail defaults to noreply@lit.solar", () => {
      expect(template.Parameters.SesFromEmail.Default).toBe(
        "noreply@lit.solar",
      );
    });
  });

  describe("Lambda functions", () => {
    const specs = [
      {
        name: "CheckoutFunction",
        path: "/api/checkout",
        method: "POST",
        memory: 256,
      },
      {
        name: "WebhookFunction",
        path: "/api/webhook",
        method: "POST",
        memory: 256,
      },
      {
        name: "LicenseFunction",
        path: "/api/license",
        method: "GET",
        memory: 256,
      },
      {
        name: "ValidateFunction",
        path: "/api/validate",
        method: "GET",
        memory: 256,
      },
      {
        name: "RecoverFunction",
        path: "/api/recover",
        method: "POST",
        memory: 256,
      },
      {
        name: "SuccessPageFunction",
        path: "/purchase/success",
        method: "GET",
        memory: 256,
      },
      {
        name: "CancelPageFunction",
        path: "/purchase/cancel",
        method: "GET",
        memory: 128,
      },
      {
        name: "RecoverPageFunction",
        path: "/recover",
        method: "GET",
        memory: 128,
      },
      {
        name: "EarlyAccessPageFunction",
        path: "/early-access",
        method: "GET",
        memory: 256,
      },
      {
        name: "EarlyAccessFunction",
        path: "/api/early-access",
        method: "POST",
        memory: 256,
      },
    ];

    it.each(specs)(
      "$name exists with correct type, memory, path, and method",
      ({ name, path, method, memory }) => {
        const fn = template.Resources[name];
        expect(fn).toBeDefined();
        expect(fn.Type).toBe("AWS::Serverless::Function");
        expect(fn.Properties.MemorySize).toBe(memory);

        const events = fn.Properties.Events;
        const apiEvent = (Object.values(events) as SamApiEvent[]).find(
          (e) => e.Type === "Api",
        )!
        expect(apiEvent).toBeDefined();
        expect(apiEvent.Properties.Path).toBe(path);
        expect(apiEvent.Properties.Method).toBe(method);
      },
    );

    it("WebhookFunction has 30s timeout", () => {
      expect(template.Resources.WebhookFunction.Properties.Timeout).toBe(30);
    });

    it.each(specs)("$name has esbuild BuildMethod", ({ name }) => {
      expect(template.Resources[name].Metadata?.BuildMethod).toBe("esbuild");
    });
  });

  describe("cross-cutting", () => {
    it("has exactly 10 Serverless::Function resources", () => {
      expect(resourcesOfType("AWS::Serverless::Function")).toHaveLength(10);
    });

    it("all functions use nodejs22.x runtime via Globals", () => {
      expect(template.Globals.Function.Runtime).toBe("nodejs22.x");
      for (const [, fn] of resourcesOfType("AWS::Serverless::Function")) {
        expect(fn.Properties.Runtime).toBeUndefined();
      }
    });

    it("all DynamoDBCrudPolicy scoped to LicensesTable", () => {
      for (const [, fn] of resourcesOfType("AWS::Serverless::Function")) {
        for (const policy of (fn.Properties.Policies ?? []) as Record<string, Record<string, unknown>>[]) {
          if (policy.DynamoDBCrudPolicy) {
            expect(policy.DynamoDBCrudPolicy.TableName).toEqual({
              Ref: "LicensesTable",
            });
          }
        }
      }
    });

    it("all SSMParameterReadPolicy scoped to lit/*", () => {
      for (const [, fn] of resourcesOfType("AWS::Serverless::Function")) {
        for (const policy of (fn.Properties.Policies ?? []) as Record<string, Record<string, unknown>>[]) {
          if (policy.SSMParameterReadPolicy) {
            expect(policy.SSMParameterReadPolicy.ParameterName).toBe("lit/*");
          }
        }
      }
    });

    it("all functions have TABLE_NAME and BASE_URL env vars", () => {
      const vars = template.Globals.Function.Environment.Variables;
      expect(vars.TABLE_NAME).toBeDefined();
      expect(vars.BASE_URL).toBeDefined();
    });

    it("static functions have no Policies", () => {
      for (const name of ["CancelPageFunction", "RecoverPageFunction"]) {
        expect(template.Resources[name].Properties.Policies).toBeUndefined();
      }
    });

    it("EarlyAccessPageFunction has only SSMParameterReadPolicy", () => {
      const policies = template.Resources.EarlyAccessPageFunction.Properties.Policies;
      expect(policies).toHaveLength(1);
      expect(policies[0]).toHaveProperty("SSMParameterReadPolicy");
    });
  });

  describe("Outputs", () => {
    it("exports ApiUrl", () => {
      expect(template.Outputs.ApiUrl).toBeDefined();
    });

    it("exports LicensesTableName", () => {
      expect(template.Outputs.LicensesTableName).toBeDefined();
      expect(template.Outputs.LicensesTableName.Value).toEqual({
        Ref: "LicensesTable",
      });
    });

    it("exports LicensesTableArn", () => {
      expect(template.Outputs.LicensesTableArn).toBeDefined();
      expect(template.Outputs.LicensesTableArn.Value).toEqual({
        "Fn::GetAtt": ["LicensesTable", "Arn"],
      });
    });
  });
});
