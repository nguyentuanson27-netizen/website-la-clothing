const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;
const SIGN_IN_ERROR_MESSAGE = "Không thể đăng nhập với thông tin này.";
const SIGN_UP_ERROR_MESSAGE = "Không thể tạo tài khoản với thông tin này. Hãy thử đăng nhập hoặc dùng email khác.";

export type AccountAuthResult =
  | { ok: true }
  | { ok: false; message: string };

type AuthCallResult = {
  error?: {
    message?: string;
  } | null;
};

type EmailSignInPayload = {
  email: string;
  password: string;
  rememberMe: boolean;
};

type EmailSignUpPayload = {
  name: string;
  email: string;
  password: string;
};

type EmailSignInCall = (payload: EmailSignInPayload) => Promise<AuthCallResult>;
type EmailSignUpCall = (payload: EmailSignUpPayload) => Promise<AuthCallResult>;

function hasValidPasswordLength(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH && password.length <= MAX_PASSWORD_LENGTH;
}

async function callAuth<TPayload>(
  call: (payload: TPayload) => Promise<AuthCallResult>,
  payload: TPayload,
  errorMessage: string,
): Promise<AccountAuthResult> {
  try {
    const result = await call(payload);
    return result.error ? { ok: false, message: errorMessage } : { ok: true };
  } catch {
    return { ok: false, message: errorMessage };
  }
}

export async function submitEmailSignIn(
  call: EmailSignInCall,
  input: { email: string; password: string },
): Promise<AccountAuthResult> {
  const email = input.email.trim();

  if (!email || !hasValidPasswordLength(input.password)) {
    return { ok: false, message: "Kiểm tra lại email và mật khẩu." };
  }

  return callAuth(
    call,
    {
      email,
      password: input.password,
      rememberMe: true,
    },
    SIGN_IN_ERROR_MESSAGE,
  );
}

export async function submitEmailSignUp(
  call: EmailSignUpCall,
  input: { name: string; email: string; password: string },
): Promise<AccountAuthResult> {
  const name = input.name.trim();
  const email = input.email.trim();

  if (!name || !email || !hasValidPasswordLength(input.password)) {
    return { ok: false, message: "Kiểm tra lại họ tên, email và mật khẩu." };
  }

  return callAuth(
    call,
    {
      name,
      email,
      password: input.password,
    },
    SIGN_UP_ERROR_MESSAGE,
  );
}
