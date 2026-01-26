import { WsJwtAuthenticationGuard } from './ws-jwt-authentication.guard';

describe('WsJwtAuthenticationGuard', () => {
  const createGuard = (overrides: Partial<any> = {}) => {
    const jwtService = { verifyAsync: jest.fn() };
    const configService = { get: jest.fn().mockReturnValue('secret') };
    const usersService = { getById: jest.fn() };

    const guard = new WsJwtAuthenticationGuard(
      (overrides.jwtService ?? jwtService) as any,
      (overrides.configService ?? configService) as any,
      (overrides.usersService ?? usersService) as any
    );

    return { guard, jwtService, configService, usersService };
  };

  const createContext = (client: any) =>
    ({
      switchToWs: () => ({ getClient: () => client })
    }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects when no token is provided', async () => {
    const { guard } = createGuard();
    const client = { handshake: { auth: {}, headers: {}, query: {} }, emit: jest.fn(), data: {} };

    const result = await guard.canActivate(createContext(client));

    expect(result).toBe(false);
    expect(client.emit).toHaveBeenCalledWith('error', { message: 'Authentication required' });
  });

  it('rejects when token type is invalid', async () => {
    const { guard, jwtService } = createGuard();
    const client = { handshake: { auth: { token: 'token' }, headers: {}, query: {} }, emit: jest.fn(), data: {} };

    jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', type: 'refresh' });

    const result = await guard.canActivate(createContext(client));

    expect(result).toBe(false);
    expect(client.emit).toHaveBeenCalledWith('error', { message: 'Authentication failed' });
  });

  it('rejects when user is not found', async () => {
    const { guard, jwtService, usersService } = createGuard();
    const client = { handshake: { auth: { token: 'token' }, headers: {}, query: {} }, emit: jest.fn(), data: {} };

    jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', type: 'access' });
    usersService.getById.mockResolvedValue(null);

    const result = await guard.canActivate(createContext(client));

    expect(result).toBe(false);
    expect(client.emit).toHaveBeenCalledWith('error', { message: 'Authentication failed' });
  });

  it('rejects when verification throws', async () => {
    const { guard, jwtService } = createGuard();
    const client = { handshake: { auth: { token: 'token' }, headers: {}, query: {} }, emit: jest.fn(), data: {} };

    jwtService.verifyAsync.mockRejectedValue(new Error('token expired'));

    const result = await guard.canActivate(createContext(client));

    expect(result).toBe(false);
    expect(client.emit).toHaveBeenCalledWith('error', { message: 'Authentication failed' });
  });

  it('attaches user when token is valid', async () => {
    const { guard, jwtService, usersService } = createGuard();
    const client = {
      handshake: { auth: { token: 'token' }, headers: {}, query: {} },
      emit: jest.fn(),
      data: {} as Record<string, unknown>
    };

    jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', type: 'access' });
    usersService.getById.mockResolvedValue({ id: 'user-1' });

    const result = await guard.canActivate(createContext(client));

    expect(result).toBe(true);
    expect(client.data.user).toEqual({ id: 'user-1' });
  });

  it('logs warning when token is extracted from query string', async () => {
    const { guard, jwtService, usersService } = createGuard();
    const client = {
      id: 'client-123',
      handshake: { auth: {}, headers: {}, query: { token: 'query-token' } },
      emit: jest.fn(),
      data: {} as Record<string, unknown>
    };

    jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', type: 'access' });
    usersService.getById.mockResolvedValue({ id: 'user-1' });

    const warnSpy = jest.spyOn((guard as any).logger, 'warn').mockImplementation();

    const result = await guard.canActivate(createContext(client));

    expect(result).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('using query string token authentication'));
  });
});
