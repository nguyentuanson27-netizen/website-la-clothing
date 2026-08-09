const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

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

export async function submitEmailSignIn(
  call: EmailSignInCall,
  input: { email: string; password: string },
): Promise<AccountAuthResult> {
  const email = input.email.trim();

  if (!email || !hasValidPasswordLength(input.password)) {
    return { ok: false, message: "Kiểm tra lại email và mật khẩu." };
  }

  const result = await call({
    email,
    password: input.password,
    rememberMe: true,
  });

  if (result.error) {
    return { ok: false, message: "Không thể đăng nhập với thông tin này." };
  }

  return { ok: true };
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

  const result = await call({
    name,
    email,
    password: input.password,
  });

  if (result.error) {
    return {
      ok: false,
      message: "Không thể tạo tài khoản với thông tin này. Hãy thử đăng nhập hoặc dùng email khác.",
    };
  }

  return { ok: true };
}
