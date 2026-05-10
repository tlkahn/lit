import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadConfig, resetConfigCache } from "../src/config.js";

const PRIVATE_KEY_SEED = new Uint8Array(32).fill(0x42);
const PRIVATE_KEY_B64 = btoa(String.fromCharCode(...PRIVATE_KEY_SEED));

const defaultSsmParams: Record<string, string> = {
  "/lit/private-key": PRIVATE_KEY_B64,
  "/lit/stripe-secret-key": "sk_test_123",
  "/lit/webhook-secret": "whsec_test_456",
};

const defaultEnvVars: Record<string, string> = {
  TABLE_NAME: "test-licenses",
  STRIPE_PRICE_ID: "price_test_789",
  BASE_URL: "https://example.com",
  SES_FROM_EMAIL: "noreply@test.com",
};

function makeSsmClient(params: Record<string, string> = defaultSsmParams) {
  const parameters = Object.entries(params).map(([Name, Value]) => ({
    Name,
    Value,
  }));
  return { send: vi.fn().mockResolvedValue({ Parameters: parameters }) };
}

describe("loadConfig", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    resetConfigCache();
    for (const [key, value] of Object.entries(defaultEnvVars)) {
      savedEnv[key] = process.env[key];
      process.env[key] = value;
    }
  });

  afterEach(() => {
    for (const key of Object.keys(defaultEnvVars)) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it("returns Config with all fields from SSM + env vars", async () => {
    const ssm = makeSsmClient();
    const config = await loadConfig(ssm as any);

    expect(config.tableName).toBe("test-licenses");
    expect(config.stripePriceId).toBe("price_test_789");
    expect(config.baseUrl).toBe("https://example.com");
    expect(config.sesFromEmail).toBe("noreply@test.com");
    expect(config.stripeSecretKey).toBe("sk_test_123");
    expect(config.webhookSecret).toBe("whsec_test_456");
  });

  it("calls SSM with correct param names and WithDecryption", async () => {
    const ssm = makeSsmClient();
    await loadConfig(ssm as any);

    expect(ssm.send).toHaveBeenCalledOnce();
    const command = ssm.send.mock.calls[0]![0];
    expect(command.input).toEqual({
      Names: [
        "/lit/private-key",
        "/lit/stripe-secret-key",
        "/lit/webhook-secret",
      ],
      WithDecryption: true,
    });
  });

  it("decodes privateKey as Uint8Array matching seed bytes", async () => {
    const ssm = makeSsmClient();
    const config = await loadConfig(ssm as any);

    expect(config.privateKey).toBeInstanceOf(Uint8Array);
    expect(config.privateKey.length).toBe(32);
    expect(config.privateKey).toEqual(PRIVATE_KEY_SEED);
  });

  it("caches result — second call does not hit SSM again", async () => {
    const ssm = makeSsmClient();
    const first = await loadConfig(ssm as any);
    const second = await loadConfig(ssm as any);

    expect(ssm.send).toHaveBeenCalledOnce();
    expect(second).toBe(first);
  });

  it("resetConfigCache forces next call to hit SSM", async () => {
    const ssm = makeSsmClient();
    await loadConfig(ssm as any);
    resetConfigCache();
    await loadConfig(ssm as any);

    expect(ssm.send).toHaveBeenCalledTimes(2);
  });

  it("rejects when TABLE_NAME env var is missing", async () => {
    delete process.env.TABLE_NAME;
    const ssm = makeSsmClient();

    await expect(loadConfig(ssm as any)).rejects.toThrow(/TABLE_NAME/);
  });

  it("rejects when an SSM parameter is missing", async () => {
    const partial = { ...defaultSsmParams };
    delete partial["/lit/stripe-secret-key"];
    const ssm = makeSsmClient(partial);

    await expect(loadConfig(ssm as any)).rejects.toThrow(/stripe-secret-key/);
  });

  it("rejects when env var is empty string", async () => {
    process.env.TABLE_NAME = "";
    const ssm = makeSsmClient();
    await expect(loadConfig(ssm as any)).rejects.toThrow(/TABLE_NAME/);
  });

  it("rejects when SSM param has undefined Value", async () => {
    const ssm = {
      send: vi.fn().mockResolvedValue({
        Parameters: [
          { Name: "/lit/private-key", Value: undefined },
          { Name: "/lit/stripe-secret-key", Value: "sk_test_123" },
          { Name: "/lit/webhook-secret", Value: "whsec_test_456" },
        ],
      }),
    };
    await expect(loadConfig(ssm as any)).rejects.toThrow(/private-key/);
  });

  it("propagates SSM client errors", async () => {
    const ssm = {
      send: vi.fn().mockRejectedValue(new Error("SSM unavailable")),
    };

    await expect(loadConfig(ssm as any)).rejects.toThrow("SSM unavailable");
  });

  it("does not cache failed loads — retry succeeds after failure", async () => {
    const params = Object.entries(defaultSsmParams).map(([Name, Value]) => ({
      Name,
      Value,
    }));
    const ssm = {
      send: vi
        .fn()
        .mockRejectedValueOnce(new Error("transient"))
        .mockResolvedValueOnce({ Parameters: params }),
    };

    await expect(loadConfig(ssm as any)).rejects.toThrow("transient");
    const config = await loadConfig(ssm as any);
    expect(config.tableName).toBe("test-licenses");
    expect(ssm.send).toHaveBeenCalledTimes(2);
  });
});
