import { AlgorithmRegistry } from './algorithm-registry.service';

import { AlgorithmNotRegisteredException } from '../../common/exceptions';
import { AlgorithmContext } from '../interfaces';

describe('AlgorithmRegistry.executeAlgorithm', () => {
  it('throws when no strategy is registered for the algorithm', async () => {
    const registry = new AlgorithmRegistry({} as any, {} as any);
    const context = {} as AlgorithmContext;

    await expect(registry.executeAlgorithm('algo-1', context)).rejects.toBeInstanceOf(AlgorithmNotRegisteredException);
  });
});
