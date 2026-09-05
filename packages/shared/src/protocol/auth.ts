import { z } from 'zod';
import { API_PREFIX, EmptySchema, endpoint } from './common.js';

export const UsernameSchema = z
  .string()
  .min(3)
  .max(20)
  .regex(/^[A-Za-z0-9_-]+$/, '用户名只能包含字母、数字、下划线和连字符');

export const PasswordSchema = z.string().min(6).max(72);

export const UserSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  isAdmin: z.boolean(),
  banned: z.boolean(),
  createdAt: z.number().int(),
  /** null until the player has created a cultivator. */
  characterId: z.string().min(1).nullable(),
});
export type User = z.infer<typeof UserSchema>;

export const AuthSessionSchema = z.object({
  token: z.string().min(1),
  /** Epoch ms at which the token stops being accepted. */
  expiresAt: z.number().int(),
  user: UserSchema,
});
export type AuthSession = z.infer<typeof AuthSessionSchema>;

export const RegisterRequestSchema = z.object({
  username: UsernameSchema,
  password: PasswordSchema,
  /** Required when `WorldSettings.inviteRequired` is on. */
  inviteCode: z.string().min(1).max(64).optional(),
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z.object({
  username: UsernameSchema,
  password: PasswordSchema,
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const MeResponseSchema = z.object({
  user: UserSchema,
  /** Server clock, so the client can correct drift before rendering timers. */
  serverTime: z.number().int(),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const authEndpoints = {
  register: endpoint({
    method: 'POST',
    path: `${API_PREFIX}/auth/register`,
    auth: 'none',
    request: RegisterRequestSchema,
    response: AuthSessionSchema,
    errors: ['USERNAME_TAKEN', 'INVITE_REQUIRED', 'INVITE_INVALID', 'REGISTRATION_CLOSED'],
    summary: '注册账号（世界设置开启邀请码时必须提供 inviteCode）',
  }),
  login: endpoint({
    method: 'POST',
    path: `${API_PREFIX}/auth/login`,
    auth: 'none',
    request: LoginRequestSchema,
    response: AuthSessionSchema,
    errors: ['INVALID_CREDENTIALS', 'BANNED'],
    summary: '登录，返回 Socket.IO 握手也要用的 token',
  }),
  logout: endpoint({
    method: 'POST',
    path: `${API_PREFIX}/auth/logout`,
    auth: 'user',
    request: EmptySchema,
    response: EmptySchema,
    errors: [],
    summary: '注销当前 token',
  }),
  me: endpoint({
    method: 'GET',
    path: `${API_PREFIX}/auth/me`,
    auth: 'user',
    request: EmptySchema,
    response: MeResponseSchema,
    errors: ['BANNED'],
    summary: '取当前账号与服务器时间',
  }),
} as const;
