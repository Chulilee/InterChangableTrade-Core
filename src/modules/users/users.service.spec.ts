import { ConflictException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';

type RepoMock = {
  findOne: jest.Mock;
  findAndCount: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  delete: jest.Mock;
};

/**
 * Unit tests for the service's branching logic. The repository is mocked so the
 * tests run without a database.
 */
describe('UsersService', () => {
  let service: UsersService;
  let repo: RepoMock;

  beforeEach(() => {
    repo = {
      findOne: jest.fn(),
      findAndCount: jest.fn(),
      create: jest.fn((v) => v),
      save: jest.fn((v) => Promise.resolve({ id: 'u1', ...v })),
      delete: jest.fn(),
    };
    service = new UsersService(repo as unknown as never);
  });

  it('rejects a duplicate email', async () => {
    repo.findOne.mockResolvedValue({ id: 'existing' } as User);
    await expect(
      service.create({ email: 'a@b.com', password: 'secret12' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('hashes the password on create', async () => {
    repo.findOne.mockResolvedValue(null);
    const created = await service.create({
      email: 'a@b.com',
      password: 'secret12',
    });
    expect(created.passwordHash).toBeDefined();
    expect(created.passwordHash).not.toBe('secret12');
  });

  it('throws when a user is missing', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.findOne('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
