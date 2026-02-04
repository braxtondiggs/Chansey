import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { Role } from '@chansey/api-interfaces';

import { RefreshTokenService } from './refresh-token.service';

import { User } from '../users/users.entity';
import { UsersService } from '../users/users.service';

type TestUser = User & { roles?: Role[] };

describe('RefreshTokenService', () => {
  let configStore: Record<string, any>;
  let configService: { get: jest.Mock };
  let jwtService: { signAsync: jest.Mock; verifyAsync: jest.Mock };
  let usersService: { getById: jest.Mock; getProfile: jest.Mock };
  let service: RefreshTokenService;

  beforeEach(() => {
    configStore = {
      JWT_REFRESH_SECRET: 'refresh-secret',
      JWT_SECRET: 'access-secret',
      JWT_EXPIRATION_TIME: '15m',
      JWT_REFRESH_EXPIRATION_TIME: '7d',
      NODE_ENV: 'development'
    };

    configService = {
      get: jest.fn((key: string, defaultValue?: any) => (key in configStore ? configStore[key] : defaultValue))
    };

    jwtService = {
      signAsync: jest.fn(),
      verifyAsync: jest.fn()
    };

    usersService = {
      getById: jest.fn(),
      getProfile: jest.fn()
    };

    service = new RefreshTokenService(
      configService as unknown as ConfigService,
      jwtService as unknown as JwtService,
      usersService as unknown as UsersService
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns new tokens and rememberMe=false when refresh token is near expiry', async () => {
    const payload = { sub: 'user-123', exp: 1_700_000_000 + 7 * 24 * 60 * 60 };
    const baseUser = { id: payload.sub, email: 'user@example.com' } as TestUser;
    const fullUser = { ...baseUser, roles: [Role.ADMIN] };
    const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

    jwtService.verifyAsync.mockResolvedValue(payload);
    usersService.getById.mockResolvedValue(baseUser);
    usersService.getProfile.mockResolvedValue(fullUser);
    jwtService.signAsync.mockResolvedValueOnce('new-access-token').mockResolvedValueOnce('new-refresh-token');

    const result = await service.refreshAccessToken('existing-refresh');

    expect(result).toEqual({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      rememberMe: false
    });
    expect(jwtService.verifyAsync).toHaveBeenCalledWith(
      'existing-refresh',
      expect.objectContaining({ secret: 'refresh-secret', algorithms: ['HS512'] })
    );
    expect(usersService.getById).toHaveBeenCalledWith(payload.sub);
    expect(usersService.getProfile).toHaveBeenCalledWith(baseUser);
    expect(jwtService.signAsync).toHaveBeenCalledTimes(2);

    dateNowSpy.mockRestore();
  });

  it('returns rememberMe=true when refresh token has long expiration', async () => {
    const payload = { sub: 'user-999', exp: 1_700_000_000 + 31 * 24 * 60 * 60 };
    const baseUser = { id: payload.sub, email: 'remember@example.com' } as TestUser;
    const fullUser = { ...baseUser, roles: [Role.USER] };
    const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

    jwtService.verifyAsync.mockResolvedValue(payload);
    usersService.getById.mockResolvedValue(baseUser);
    usersService.getProfile.mockResolvedValue(fullUser);
    jwtService.signAsync.mockResolvedValueOnce('another-access-token').mockResolvedValueOnce('another-refresh-token');

    const result = await service.refreshAccessToken('long-lived-token');

    expect(result.rememberMe).toBe(true);
    expect(jwtService.signAsync.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ expiresIn: '30d', secret: 'refresh-secret' })
    );

    dateNowSpy.mockRestore();
  });

  it('throws UnauthorizedException when token verification fails', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('invalid'));

    await expect(service.refreshAccessToken('bad-token')).rejects.toThrow(
      new UnauthorizedException('Invalid refresh token')
    );
  });

  it('throws UnauthorizedException when user cannot be found', async () => {
    const payload = { sub: 'missing-user', exp: 1_700_000_000 + 10 };

    jwtService.verifyAsync.mockResolvedValue(payload);
    usersService.getById.mockResolvedValue(null);

    await expect(service.refreshAccessToken('valid-token')).rejects.toThrow(
      new UnauthorizedException('Invalid refresh token')
    );
  });

  it('generates access tokens with provided roles', async () => {
    const user = { id: 'user-1', email: 'role@example.com', roles: [Role.ADMIN] } as TestUser;

    jwtService.signAsync.mockResolvedValue('signed-access');

    const token = await service.generateAccessToken(user);

    expect(token).toBe('signed-access');
    expect(jwtService.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: user.id,
        email: user.email,
        roles: [Role.ADMIN],
        type: 'access'
      }),
      expect.objectContaining({
        secret: 'access-secret',
        expiresIn: '15m',
        algorithm: 'HS512'
      })
    );
  });

  it('defaults access token roles to user when none provided', async () => {
    const user = { id: 'user-2', email: 'nouser@example.com' } as TestUser;

    jwtService.signAsync.mockResolvedValue('signed-default-access');

    await service.generateAccessToken(user);

    expect(jwtService.signAsync.mock.calls[0][0]).toEqual(
      expect.objectContaining({ roles: [Role.USER], type: 'access' })
    );
  });

  it('generates refresh token with configured expiration when rememberMe is false', async () => {
    const user = { id: 'user-3', roles: [Role.USER] } as TestUser;

    jwtService.signAsync.mockResolvedValue('signed-refresh');

    const token = await service.generateRefreshToken(user, false);

    expect(token).toBe('signed-refresh');
    expect(jwtService.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ sub: user.id, roles: [Role.USER], type: 'refresh' }),
      expect.objectContaining({ expiresIn: '7d', secret: 'refresh-secret', algorithm: 'HS512' })
    );
  });

  it('uses 30 day expiration when rememberMe is true', async () => {
    const user = { id: 'user-4' } as TestUser;

    jwtService.signAsync.mockResolvedValue('long-refresh');

    await service.generateRefreshToken(user, true);

    expect(jwtService.signAsync.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ expiresIn: '30d', secret: 'refresh-secret' })
    );
    expect(configService.get).not.toHaveBeenCalledWith('JWT_REFRESH_EXPIRATION_TIME', expect.anything());
  });

  it('returns cookies with localhost domain in development', () => {
    configStore.NODE_ENV = 'development';

    const cookies = service.getCookieWithTokens('access-token', 'refresh-token');

    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain('chansey_access=access-token');
    expect(cookies[0]).toContain('Max-Age=900');
    expect(cookies[0]).toContain('Domain=localhost');
    expect(cookies[0]).not.toContain('Secure;');
    expect(cookies[1]).toContain('Max-Age=604800');
  });

  it('returns secure cookies with cymbit domain in production', () => {
    configStore.NODE_ENV = 'production';

    const cookies = service.getCookieWithTokens('prod-access', 'prod-refresh', true);

    expect(cookies[0]).toContain('Secure;');
    expect(cookies[0]).toContain('Domain=.cymbit.com');
    expect(cookies[1]).toContain('Max-Age=2592000');
  });

  it('returns logout cookies clearing tokens in development', () => {
    configStore.NODE_ENV = 'development';

    const cookies = service.getCookiesForLogOut();

    expect(cookies[0]).toContain('chansey_access=');
    expect(cookies[0]).toContain('Max-Age=0');
    expect(cookies[0]).toContain('Domain=localhost');
    expect(cookies[0]).not.toContain('Secure;');
    expect(cookies[1]).toContain('Max-Age=0');
  });

  it('returns secure logout cookies in production', () => {
    configStore.NODE_ENV = 'production';

    const cookies = service.getCookiesForLogOut();

    expect(cookies[0]).toContain('Secure;');
    expect(cookies[0]).toContain('Domain=.cymbit.com');
    expect(cookies[1]).toContain('Secure;');
  });
});
