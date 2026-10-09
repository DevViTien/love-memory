import { describe, expect, it } from "vitest";

import { isValidDataSignature, signData, signPaymentRequest } from "./payos-signature";

// Every expected value below was computed with `@payos/node` 2.0.5 (`NodeCryptoProvider`
// `createSignatureOfPaymentRequest` and `createSignatureFromObj`) for these inputs.
const KEY = "lovememory-test-checksum-key-0001";

const REQUEST = {
  amount: 49_000,
  cancelUrl: "https://lovememory.example/checkout/cancel?order=o-1",
  description: "LM 123456789",
  orderCode: 123_456_789,
  returnUrl: "https://lovememory.example/checkout/return?order=o-1",
};

const WEBHOOK_DATA = {
  orderCode: 123_456_789,
  amount: 49_000,
  description: "LM 123456789",
  accountNumber: "12345678",
  reference: "TF230204212323",
  transactionDateTime: "2026-10-10 10:00:00",
  currency: "VND",
  paymentLinkId: "124c33293c43417ab7879e14c8d9eb18",
  code: "00",
  desc: "Thành công",
  counterAccountBankId: "",
  counterAccountBankName: "",
  counterAccountName: null,
  counterAccountNumber: null,
  virtualAccountName: null,
  virtualAccountNumber: null,
};

const PAYMENT_INFO = {
  id: "124c33293c43417ab7879e14c8d9eb18",
  orderCode: 123_456_789,
  amount: 49_000,
  amountPaid: 49_000,
  amountRemaining: 0,
  status: "PAID",
  createdAt: "2026-10-10T10:00:00+07:00",
  transactions: [
    {
      reference: "TF230204212323",
      amount: 49_000,
      accountNumber: "12345678",
      description: "LM 123456789",
      transactionDateTime: "2026-10-10T10:00:00+07:00",
      virtualAccountName: null,
      virtualAccountNumber: null,
      counterAccountBankId: null,
      counterAccountBankName: null,
      counterAccountName: null,
      counterAccountNumber: null,
    },
  ],
  canceledAt: null,
  cancellationReason: null,
};

const CREATED_LINK = {
  bin: "970422",
  accountNumber: "113366668888",
  accountName: "LOVEMEMORY",
  amount: 49_000,
  description: "LM 123456789",
  orderCode: 123_456_789,
  currency: "VND",
  paymentLinkId: "124c33293c43417ab7879e14c8d9eb18",
  status: "PENDING",
  expiredAt: 1_791_000_000,
  checkoutUrl: "https://pay.payos.vn/web/124c33293c43417ab7879e14c8d9eb18",
  qrCode: "00020101021238570010A000000727",
};

describe("payOS signatures (@payos/node 2.0.5 vectors)", () => {
  it("signs a create-payment request", () => {
    expect(signPaymentRequest(REQUEST, KEY)).toBe(
      "5227403773c4066662e6de42fac07f9bd92a16065094db56392fe217b77d228e",
    );
  });

  it("signs webhook data with nulls and empty strings", () => {
    expect(signData(WEBHOOK_DATA, KEY)).toBe(
      "22372314071c0f70a44646dd4e2480fa092b99d5adaf3ebad43427e224c29d6c",
    );
  });

  it("signs payment information with a nested transaction list", () => {
    expect(signData(PAYMENT_INFO, KEY)).toBe(
      "0c299ba19252a5d6decf1d7be38627797992d460aded7eb8338a8be765fa0e6a",
    );
  });

  it("signs a created payment link", () => {
    expect(signData(CREATED_LINK, KEY)).toBe(
      "3084e649bbcd51f625186f35e2edff5c63ba0ef0b0244f0940c1d5a52f0013d6",
    );
  });

  it("verifies in constant time and rejects tampered or malformed signatures (Tampered response)", () => {
    const signature = "3084e649bbcd51f625186f35e2edff5c63ba0ef0b0244f0940c1d5a52f0013d6";
    expect(isValidDataSignature(CREATED_LINK, signature, KEY)).toBe(true);
    expect(
      isValidDataSignature(
        { ...CREATED_LINK, checkoutUrl: "https://attacker.example/pay" },
        signature,
        KEY,
      ),
    ).toBe(false);
    expect(isValidDataSignature(CREATED_LINK, signature, "another-key")).toBe(false);
    expect(isValidDataSignature(CREATED_LINK, "not-hex", KEY)).toBe(false);
    expect(isValidDataSignature(CREATED_LINK, signature.toUpperCase(), KEY)).toBe(false);
  });
});
