import { jest } from '@jest/globals';
import { SearchWorkItemsOperation } from '../../operations/general/search-work-items.js';
import { ShowMyTasksOperation } from '../../operations/work/show-my-tasks.js';
import { TPService } from '../../api/client/tp.service.js';
import { ExecutionContext } from '../../core/interfaces/semantic-operation.interface.js';

jest.mock('../../utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

const mockService = {
  searchEntities: jest.fn(),
  getEntity: jest.fn(),
  createEntity: jest.fn(),
  updateEntity: jest.fn(),
} as unknown as jest.Mocked<TPService>;

const mockContext: ExecutionContext = {
  user: {
    id: 12345,
    name: 'Test User',
    email: 'test@example.com',
    role: 'developer',
    teams: [],
    permissions: []
  },
  workspace: { recentEntities: [] },
  personality: { mode: 'developer', features: [], restrictions: {} },
  conversation: { mentionedEntities: [], previousOperations: [], intent: 'test' },
  config: {
    apiUrl: 'https://example.tpondemand.com',
    maxResults: 25,
    timeout: 30000
  }
};

beforeEach(() => {
  jest.clearAllMocks();
  (mockService.searchEntities as jest.MockedFunction<typeof mockService.searchEntities>)
    .mockResolvedValue([]);
});

describe('SearchWorkItemsOperation - TQL injection prevention', () => {
  it('escapes single quotes in query before inserting into where clause', async () => {
    const op = new SearchWorkItemsOperation(mockService as unknown as TPService);
    await op.execute(mockContext, { query: "O'Brien", limit: 20 });

    const calls = (mockService.searchEntities as jest.Mock).mock.calls;
    const whereArgs = calls.map(c => c[1] as string);
    whereArgs.forEach(where => {
      if (where && where.includes('contains')) {
        // Must not contain an unescaped apostrophe inside the quoted value
        // Correct: Name contains 'O''Brien'
        // Wrong:   Name contains 'O'Brien'
        expect(where).toContain("O''Brien");
      }
    });
    // At least one search was made
    expect(calls.length).toBeGreaterThan(0);
  });

  it('handles injection attempt that would append extra clauses', async () => {
    const op = new SearchWorkItemsOperation(mockService as unknown as TPService);
    // Without escaping, "' or '1'='1" would break out of the quoted value
    await op.execute(mockContext, { query: "' or '1'='1", limit: 20 });

    const calls = (mockService.searchEntities as jest.Mock).mock.calls;
    const whereArgs = calls.map(c => c[1] as string).filter(Boolean);
    whereArgs.forEach(where => {
      if (where.includes('contains')) {
        // The injected value must be fully inside a quoted string, not loose
        // Any single quotes in the user value must be doubled
        const valueMatch = where.match(/contains\s+'([^']|'')*'/);
        expect(valueMatch).not.toBeNull();
      }
    });
  });
});

describe('ShowMyTasksOperation - TQL injection prevention', () => {
  it('escapes single quotes in projectFilter before inserting into where clause', async () => {
    const op = new ShowMyTasksOperation(mockService as unknown as TPService);
    await op.execute(mockContext, {
      projectFilter: "O'Brien's Project",
      includeCompleted: true,
      priority: 'all',
      limit: 20
    });

    const calls = (mockService.searchEntities as jest.Mock).mock.calls;
    // Find the call that searches for tasks (not EntityState or Priority)
    const taskSearchCalls = calls.filter(c => c[0] === 'Task');
    expect(taskSearchCalls.length).toBeGreaterThan(0);

    taskSearchCalls.forEach(callArgs => {
      const where = callArgs[1] as string;
      if (where && where.includes('Project.Name')) {
        expect(where).toContain("O''Brien''s Project");
      }
    });
  });
});
