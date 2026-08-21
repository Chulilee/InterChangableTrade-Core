import { BaseRepository } from '@app/common';
import { BaseEntity } from '@app/common';

class Widget extends BaseEntity {
  name: string;
}

type FindAndCountMock = jest.Mock;

/**
 * The repository is exercised through a stubbed `findAndCount` so the
 * pagination math and envelope construction can be verified without a
 * database.
 */
describe('BaseRepository.findPaginated', () => {
  const buildRepo = (total: number, rows: Widget[]) => {
    const repo = Object.create(BaseRepository.prototype) as BaseRepository<Widget>;
    repo.findAndCount = jest.fn().mockResolvedValue([rows, total]) as FindAndCountMock;
    return repo as BaseRepository<Widget> & { findAndCount: FindAndCountMock };
  };

  it('computes skip/take from the requested page', async () => {
    const repo = buildRepo(55, []);
    await repo.findPaginated({ page: 3, limit: 20 });

    expect(repo.findAndCount).toHaveBeenCalledWith({
      skip: 40,
      take: 20,
      where: undefined,
      order: { createdAt: 'DESC' },
    });
  });

  it('returns the shared pagination envelope', async () => {
    const rows = [{ id: 'w1' } as Widget];
    const result = await buildRepo(55, rows).findPaginated({ page: 2, limit: 20 });

    expect(result.data).toEqual(rows);
    expect(result.meta).toEqual({ total: 55, page: 2, limit: 20, totalPages: 3 });
  });

  it('clamps page below one and limit above one hundred', async () => {
    const repo = buildRepo(0, []);
    await repo.findPaginated({ page: -5, limit: 5000 });

    expect(repo.findAndCount).toHaveBeenCalledWith({
      skip: 0,
      take: 100,
      where: undefined,
      order: { createdAt: 'DESC' },
    });
  });

  it('applies defaults (page 1, limit 20) when omitted', async () => {
    const repo = buildRepo(3, []);
    await repo.findPaginated();

    expect(repo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 20 }),
    );
  });
});
