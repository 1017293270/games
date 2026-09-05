import { API_ERROR_STATUS, fail, type ApiErrorCode, type ApiFailure } from '@xianxia/shared';

/**
 * The one way a handler reports failure.
 *
 * Throwing keeps handlers linear — they return the success payload and nothing
 * else — while the route wrapper turns this into the shared `{ok:false,error}`
 * envelope with the HTTP status `API_ERROR_STATUS` prescribes.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly details: unknown;

  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return API_ERROR_STATUS[this.code];
  }

  toEnvelope(): ApiFailure {
    return this.details === undefined
      ? fail(this.code, this.message)
      : fail(this.code, this.message, this.details);
  }
}

/** Shorthand for `throw new ApiError(...)`. */
export function apiError(code: ApiErrorCode, message: string, details?: unknown): ApiError {
  return new ApiError(code, message, details);
}

/** Default zh-CN wording for codes raised from more than one place. */
export const MESSAGES = {
  UNAUTHORIZED: '请先登录',
  ADMIN_UNAUTHORIZED: '后台身份未通过校验，请重新登录',
  BANNED: '该账号已被封禁',
  CHARACTER_NOT_FOUND: '尚未创建角色',
  NOT_IMPLEMENTED: '功能尚未开放',
  VALIDATION: '请求参数有误',
  INTERNAL: '服务器内部错误',
} as const;
