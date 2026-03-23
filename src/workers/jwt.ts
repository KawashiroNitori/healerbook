import { SignJWT, jwtVerify, type JWTPayload } from 'jose'
import { nanoid } from 'nanoid'

const ALGORITHM = 'HS256'
const ACCESS_TOKEN_TTL = 60 * 60          // 1 小时（秒）
const REFRESH_TOKEN_TTL = 60 * 60 * 24 * 30  // 30 天（秒）

function getSecretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret)
}

export interface AccessTokenPayload extends JWTPayload {
  sub: string    // FFLogs user ID（字符串）
  name: string   // FFLogs username
  jti: string
}

export interface RefreshTokenPayload extends JWTPayload {
  sub: string
  jti: string
}

export async function signAccessToken(
  userId: string,
  username: string,
  secret: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ name: username })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(userId)
    .setJti(nanoid())
    .setIssuedAt(now)
    .setExpirationTime(now + ACCESS_TOKEN_TTL)
    .sign(getSecretKey(secret))
}

export async function signRefreshToken(
  userId: string,
  secret: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({})
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(userId)
    .setJti(nanoid())
    .setIssuedAt(now)
    .setExpirationTime(now + REFRESH_TOKEN_TTL)
    .sign(getSecretKey(secret))
}

export async function verifyToken(
  token: string,
  secret: string
): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(secret), {
      algorithms: [ALGORITHM],
    })
    return payload
  } catch {
    return null
  }
}
