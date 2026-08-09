import assert from "node:assert/strict";
import test from "node:test";

import {
  submitEmailSignIn,
  submitEmailSignUp,
} from "../../src/auth/account-auth.ts";

test("sign in normalizes email, preserves password bytes, and remembers the session", async () => {
  let received: unknown;

  const result = await submitEmailSignIn(
    async (input) => {
      received = input;
      return { error: null };
    },
    {
      email: "  customer@example.com  ",
      password: " pass word ",
    },
  );

  assert.deepEqual(received, {
    email: "customer@example.com",
    password: " pass word ",
    rememberMe: true,
  });
  assert.deepEqual(result, { ok: true });
});

test("sign up trims display name/email but never trims the password", async () => {
  let received: unknown;

  const result = await submitEmailSignUp(
    async (input) => {
      received = input;
      return { error: null };
    },
    {
      name: "  Sơn Nguyễn  ",
      email: "  son@example.com ",
      password: " password-123 ",
    },
  );

  assert.deepEqual(received, {
    name: "Sơn Nguyễn",
    email: "son@example.com",
    password: " password-123 ",
  });
  assert.deepEqual(result, { ok: true });
});

test("invalid account input fails before making an auth request", async () => {
  let requestCount = 0;
  const signIn = async () => {
    requestCount += 1;
    return { error: null };
  };
  const signUp = async () => {
    requestCount += 1;
    return { error: null };
  };

  assert.deepEqual(
    await submitEmailSignIn(signIn, { email: " ", password: "12345678" }),
    { ok: false, message: "Kiểm tra lại email và mật khẩu." },
  );
  assert.deepEqual(
    await submitEmailSignIn(signIn, { email: "a@example.com", password: "1234567" }),
    { ok: false, message: "Kiểm tra lại email và mật khẩu." },
  );
  assert.deepEqual(
    await submitEmailSignIn(signIn, { email: "a@example.com", password: "x".repeat(129) }),
    { ok: false, message: "Kiểm tra lại email và mật khẩu." },
  );
  assert.deepEqual(
    await submitEmailSignUp(signUp, { name: " ", email: "a@example.com", password: "12345678" }),
    { ok: false, message: "Kiểm tra lại họ tên, email và mật khẩu." },
  );
  assert.deepEqual(
    await submitEmailSignUp(signUp, { name: "A", email: " ", password: "12345678" }),
    { ok: false, message: "Kiểm tra lại họ tên, email và mật khẩu." },
  );
  assert.deepEqual(
    await submitEmailSignUp(signUp, { name: "A", email: "a@example.com", password: "x".repeat(129) }),
    { ok: false, message: "Kiểm tra lại họ tên, email và mật khẩu." },
  );

  assert.equal(requestCount, 0);
});

test("auth service errors become generic user messages instead of raw provider details", async () => {
  const rawError = "user customer@example.com already exists in database";

  const signInResult = await submitEmailSignIn(
    async () => ({ error: { message: rawError } }),
    { email: "customer@example.com", password: "12345678" },
  );
  const signUpResult = await submitEmailSignUp(
    async () => ({ error: { message: rawError } }),
    { name: "Customer", email: "customer@example.com", password: "12345678" },
  );

  assert.deepEqual(signInResult, {
    ok: false,
    message: "Không thể đăng nhập với thông tin này.",
  });
  assert.deepEqual(signUpResult, {
    ok: false,
    message: "Không thể tạo tài khoản với thông tin này. Hãy thử đăng nhập hoặc dùng email khác.",
  });
  assert.equal(JSON.stringify(signInResult).includes(rawError), false);
  assert.equal(JSON.stringify(signUpResult).includes(rawError), false);
});
