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
  {
    tag: "!Equals",
    collection: "seq" as const,
    resolve: (seq: { toJSON: () => unknown[] }) => ({
      "Fn::Equals": seq.toJSON(),
    }),
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  customTags: cfnTags as any,
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
      ["DomainName", "String"],
      ["HostedZoneId", "String"],
      ["EnableCustomDomain", "String"],
      ["SsmPrefix", "String"],
      ["TurnstileSiteKey", "String"],
    ])("has %s parameter of type %s", (name, type) => {
      expect(template.Parameters[name]).toBeDefined();
      expect(template.Parameters[name].Type).toBe(type);
    });

    it("SesFromEmail defaults to noreply@lit.solar", () => {
      expect(template.Parameters.SesFromEmail.Default).toBe(
        "noreply@lit.solar",
      );
    });

    it("DomainName defaults to lit.solar", () => {
      expect(template.Parameters.DomainName.Default).toBe("lit.solar");
    });

    it("EnableCustomDomain defaults to false", () => {
      expect(template.Parameters.EnableCustomDomain.Default).toBe("false");
    });

    it("HostedZoneId defaults to empty string", () => {
      expect(template.Parameters.HostedZoneId.Default).toBe("");
    });

    it("EnableCustomDomain allows only true/false", () => {
      expect(template.Parameters.EnableCustomDomain.AllowedValues).toEqual([
        "true",
        "false",
      ]);
    });

    it("SsmPrefix defaults to /lit/", () => {
      expect(template.Parameters.SsmPrefix.Default).toBe("/lit/");
    });

    it("TurnstileSiteKey defaults to empty string", () => {
      expect(template.Parameters.TurnstileSiteKey.Default).toBe("");
    });
  });

  describe("Conditions", () => {
    it("HasCustomDomain equals Fn::Equals with EnableCustomDomain ref", () => {
      expect(template.Conditions.HasCustomDomain).toEqual({
        "Fn::Equals": [{ Ref: "EnableCustomDomain" }, "true"],
      });
    });
  });

  describe("WebsiteBucket", () => {
    it("is AWS::S3::Bucket with HasCustomDomain condition", () => {
      const bucket = template.Resources.WebsiteBucket;
      expect(bucket).toBeDefined();
      expect(bucket.Type).toBe("AWS::S3::Bucket");
      expect(bucket.Condition).toBe("HasCustomDomain");
    });

    it("blocks all public access", () => {
      const config =
        template.Resources.WebsiteBucket.Properties.PublicAccessBlockConfiguration;
      expect(config).toEqual({
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      });
    });
  });

  describe("WebsiteBucketPolicy", () => {
    it("is AWS::S3::BucketPolicy with HasCustomDomain condition", () => {
      const policy = template.Resources.WebsiteBucketPolicy;
      expect(policy).toBeDefined();
      expect(policy.Type).toBe("AWS::S3::BucketPolicy");
      expect(policy.Condition).toBe("HasCustomDomain");
    });

    it("allows cloudfront.amazonaws.com s3:GetObject", () => {
      const statement =
        template.Resources.WebsiteBucketPolicy.Properties.PolicyDocument
          .Statement[0];
      expect(statement.Principal.Service).toBe("cloudfront.amazonaws.com");
      expect(statement.Action).toBe("s3:GetObject");
    });

    it("SourceArn is scoped to CloudFrontDistribution", () => {
      const statement =
        template.Resources.WebsiteBucketPolicy.Properties.PolicyDocument
          .Statement[0];
      expect(statement.Condition.StringEquals["AWS:SourceArn"]).toEqual({
        "Fn::Sub":
          "arn:aws:cloudfront::${AWS::AccountId}:distribution/${CloudFrontDistribution}",
      });
    });
  });

  describe("CloudFrontOAC", () => {
    it("is OriginAccessControl with s3 origin, always signing, sigv4", () => {
      const oac = template.Resources.CloudFrontOAC;
      expect(oac).toBeDefined();
      expect(oac.Type).toBe("AWS::CloudFront::OriginAccessControl");
      expect(oac.Condition).toBe("HasCustomDomain");
      const config = oac.Properties.OriginAccessControlConfig;
      expect(config.OriginAccessControlOriginType).toBe("s3");
      expect(config.SigningBehavior).toBe("always");
      expect(config.SigningProtocol).toBe("sigv4");
    });
  });

  describe("Certificate", () => {
    it("is ACM Certificate with DNS validation and HostedZoneId ref", () => {
      const cert = template.Resources.Certificate;
      expect(cert).toBeDefined();
      expect(cert.Type).toBe("AWS::CertificateManager::Certificate");
      expect(cert.Condition).toBe("HasCustomDomain");
      expect(cert.Properties.ValidationMethod).toBe("DNS");
      expect(
        cert.Properties.DomainValidationOptions[0].HostedZoneId,
      ).toEqual({ Ref: "HostedZoneId" });
    });

    it("DomainName references the DomainName parameter", () => {
      expect(template.Resources.Certificate.Properties.DomainName).toEqual({
        Ref: "DomainName",
      });
    });
  });

  describe("CloudFrontDistribution", () => {
    it("is Distribution with HasCustomDomain condition", () => {
      const dist = template.Resources.CloudFrontDistribution;
      expect(dist).toBeDefined();
      expect(dist.Type).toBe("AWS::CloudFront::Distribution");
      expect(dist.Condition).toBe("HasCustomDomain");
    });

    it("has S3Origin and ApiGatewayOrigin", () => {
      const origins =
        template.Resources.CloudFrontDistribution.Properties.DistributionConfig
          .Origins;
      expect(origins).toHaveLength(2);
      const s3 = origins.find(
        (o: { Id: string }) => o.Id === "S3Origin",
      );
      const api = origins.find(
        (o: { Id: string }) => o.Id === "ApiGatewayOrigin",
      );
      expect(s3).toBeDefined();
      expect(api).toBeDefined();
      expect(api.OriginPath).toBe("/Prod");
      expect(api.CustomOriginConfig.OriginProtocolPolicy).toBe("https-only");
    });

    it("DefaultCacheBehavior targets S3Origin with CachingOptimized", () => {
      const dcb =
        template.Resources.CloudFrontDistribution.Properties.DistributionConfig
          .DefaultCacheBehavior;
      expect(dcb.TargetOriginId).toBe("S3Origin");
      expect(dcb.CachePolicyId).toBe(
        "658327ea-f89d-4fab-a63d-7e88639e58f6",
      );
      expect(dcb.ViewerProtocolPolicy).toBe("redirect-to-https");
      expect(dcb.AllowedMethods).toEqual(["GET", "HEAD"]);
    });

    it("has Aliases and sni-only ViewerCertificate", () => {
      const config =
        template.Resources.CloudFrontDistribution.Properties.DistributionConfig;
      expect(config.Aliases).toEqual([{ Ref: "DomainName" }]);
      expect(config.ViewerCertificate.SslSupportMethod).toBe("sni-only");
    });

    it("ViewerCertificate references the Certificate resource", () => {
      const cert =
        template.Resources.CloudFrontDistribution.Properties.DistributionConfig
          .ViewerCertificate;
      expect(cert.AcmCertificateArn).toEqual({ Ref: "Certificate" });
    });

    it("S3Origin uses CloudFrontOAC for access control", () => {
      const s3Origin = template.Resources.CloudFrontDistribution.Properties
        .DistributionConfig.Origins.find(
          (o: { Id: string }) => o.Id === "S3Origin",
        );
      expect(s3Origin.OriginAccessControlId).toEqual({ Ref: "CloudFrontOAC" });
    });

    it("DefaultRootObject is index.html", () => {
      expect(
        template.Resources.CloudFrontDistribution.Properties.DistributionConfig
          .DefaultRootObject,
      ).toBe("index.html");
    });

    it("/api/* targets ApiGatewayOrigin with all 7 HTTP methods", () => {
      const behaviors =
        template.Resources.CloudFrontDistribution.Properties.DistributionConfig
          .CacheBehaviors;
      const apiBehavior = behaviors.find(
        (b: { PathPattern: string }) => b.PathPattern === "/api/*",
      );
      expect(apiBehavior).toBeDefined();
      expect(apiBehavior.TargetOriginId).toBe("ApiGatewayOrigin");
      expect(apiBehavior.CachePolicyId).toBe(
        "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
      );
      expect(apiBehavior.OriginRequestPolicyId).toBe(
        "b689b0a8-53d0-40ab-baf2-68738e2966ac",
      );
      expect(apiBehavior.AllowedMethods).toHaveLength(7);
    });

    it.each([
      "/purchase/*",
      "/early-access",
      "/recover",
      "/privacy",
      "/refund",
      "/buy",
    ])("%s targets ApiGatewayOrigin with GET/HEAD only", (path) => {
      const behaviors =
        template.Resources.CloudFrontDistribution.Properties.DistributionConfig
          .CacheBehaviors;
      const behavior = behaviors.find(
        (b: { PathPattern: string }) => b.PathPattern === path,
      );
      expect(behavior).toBeDefined();
      expect(behavior.TargetOriginId).toBe("ApiGatewayOrigin");
      expect(behavior.AllowedMethods).toEqual(["GET", "HEAD"]);
    });
  });

  describe("DNS Records", () => {
    it.each(["DnsRecordA", "DnsRecordAAAA"])(
      "%s is conditioned alias record pointing to CloudFront",
      (name) => {
        const record = template.Resources[name];
        expect(record).toBeDefined();
        expect(record.Type).toBe("AWS::Route53::RecordSet");
        expect(record.Condition).toBe("HasCustomDomain");
        expect(record.Properties.AliasTarget.HostedZoneId).toBe(
          "Z2FDTNDATAQYW2",
        );
        expect(record.Properties.AliasTarget.DNSName).toEqual({
          "Fn::GetAtt": ["CloudFrontDistribution", "DomainName"],
        });
      },
    );

    it("DnsRecordA is type A", () => {
      expect(template.Resources.DnsRecordA.Properties.Type).toBe("A");
    });

    it("DnsRecordAAAA is type AAAA", () => {
      expect(template.Resources.DnsRecordAAAA.Properties.Type).toBe("AAAA");
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
      {
        name: "PrivacyPageFunction",
        path: "/privacy",
        method: "GET",
        memory: 128,
      },
      {
        name: "RefundPageFunction",
        path: "/refund",
        method: "GET",
        memory: 128,
      },
      {
        name: "BuyPageFunction",
        path: "/buy",
        method: "GET",
        memory: 128,
      },
      {
        name: "TrialPageFunction",
        path: "/trial",
        method: "GET",
        memory: 128,
      },
      {
        name: "TrialFunction",
        path: "/api/trial",
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
    it("has exactly 15 Serverless::Function resources", () => {
      expect(resourcesOfType("AWS::Serverless::Function")).toHaveLength(15);
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

    it("all functions have TABLE_NAME, BASE_URL, and SSM_PREFIX env vars", () => {
      const vars = template.Globals.Function.Environment.Variables;
      expect(vars.TABLE_NAME).toBeDefined();
      expect(vars.BASE_URL).toBeDefined();
      expect(vars.SSM_PREFIX).toBeDefined();
    });

    it("static functions have no Policies", () => {
      for (const name of ["CancelPageFunction", "RecoverPageFunction", "PrivacyPageFunction", "RefundPageFunction", "BuyPageFunction", "TrialPageFunction"]) {
        expect(template.Resources[name].Properties.Policies).toBeUndefined();
      }
    });

    it("BuyPageFunction has TURNSTILE_SITE_KEY environment variable", () => {
      const vars = template.Resources.BuyPageFunction.Properties.Environment.Variables;
      expect(vars.TURNSTILE_SITE_KEY).toBeDefined();
    });

    it("EarlyAccessPageFunction has only SSMParameterReadPolicy", () => {
      const policies = template.Resources.EarlyAccessPageFunction.Properties.Policies;
      expect(policies).toHaveLength(1);
      expect(policies[0]).toHaveProperty("SSMParameterReadPolicy");
    });

    it("exactly 8 resources have Condition: HasCustomDomain", () => {
      const conditioned = Object.entries(template.Resources).filter(
        ([, r]) => (r as CfnResource & { Condition?: string }).Condition === "HasCustomDomain",
      );
      expect(conditioned).toHaveLength(8);
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

    it.each(["CloudFrontDomainName", "WebsiteBucketName"])(
      "%s output exists with HasCustomDomain condition",
      (name) => {
        expect(template.Outputs[name]).toBeDefined();
        expect(template.Outputs[name].Condition).toBe("HasCustomDomain");
      },
    );
  });
});
