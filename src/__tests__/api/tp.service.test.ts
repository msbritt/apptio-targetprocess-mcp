import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { TPService } from '../../api/client/tp.service.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { testConfig } from '../config/test-config.js';

const mockFetch = jest.fn() as jest.MockedFunction<typeof globalThis.fetch>;
(globalThis as any).fetch = mockFetch;

describe('TPService', () => {
  let service: TPService;

  beforeEach(async () => {
    mockFetch.mockReset();
    // Default: entity types returns empty items — validator falls back to static list
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ Items: [] })
    } as any);

    const config: any = {
      domain: testConfig.domain,
      retry: { maxRetries: 3, delayMs: 0, backoffFactor: 1 }
    };
    if (testConfig.apiKey) {
      config.apiKey = testConfig.apiKey;
    } else {
      config.credentials = { username: testConfig.username, password: testConfig.password };
    }
    service = new TPService(config);

    // Pre-warm entity type cache — prevents extra EntityTypes HTTP calls during tests
    await (service as any).entityValidator.validateEntityType('UserStory');
    mockFetch.mockClear();
  });

  describe('constructor', () => {
    it('should initialize with basic auth credentials', () => {
      expect(service).toBeDefined();
      expect((service as any).httpClient.getBaseUrl()).toBe(`https://${testConfig.domain}/api/v1`);
    });

    it('should initialize with API key', () => {
      const apiKeyService = new TPService({
        domain: testConfig.domain,
        apiKey: 'test-api-key'
      });
      expect(apiKeyService).toBeDefined();
    });

    it('should throw error without credentials', () => {
      expect(() => new TPService({
        domain: testConfig.domain
      } as any)).toThrow('Either credentials or apiKey must be provided');
    });
  });

  describe('searchEntities', () => {
    it('should search with basic parameters', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ Items: [{ Id: 1, Name: 'Test' }], Next: null })
      } as any);

      const result = await service.searchEntities('UserStory', undefined, undefined, 10);

      expect(result).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should handle where clauses', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ Items: [], Next: null })
      } as any);

      await service.searchEntities('Bug', "Priority.Name eq 'High'");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('Priority.Name'),
        expect.any(Object)
      );
    });

    it('should retry on 5xx errors', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error', json: async () => ({}) } as any)
        .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Service Unavailable', json: async () => ({}) } as any)
        .mockResolvedValue({ ok: true, json: async () => ({ Items: [], Next: null }) } as any);

      const result = await service.searchEntities('Task');

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(result).toEqual([]);
    });

    it('should not retry on 4xx errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ Message: 'Bad request' })
      } as any);

      await expect(service.searchEntities('Project')).rejects.toThrow(McpError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('getEntity', () => {
    it('should get entity by ID', async () => {
      const mockEntity = { Id: 123, Name: 'Test Entity' };
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockEntity
      } as any);

      const result = await service.getEntity('UserStory', 123);

      expect(result).toEqual(mockEntity);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/123'),
        expect.any(Object)
      );
    });

    it('should include related entities', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ Id: 1, Project: { Id: 2, Name: 'Project' } })
      } as any);

      await service.getEntity('Bug', 1, ['Project', 'AssignedUser']);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('include='),
        expect.any(Object)
      );
    });
  });

  describe('createEntity', () => {
    it('should create entity with valid data', async () => {
      const newEntity = { Id: 456, Name: 'New Story' };
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => newEntity
      } as any);

      const result = await service.createEntity('UserStory', {
        Name: 'New Story',
        Project: { Id: 1 }
      });

      expect(result).toEqual(newEntity);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateEntity', () => {
    it('should update entity fields', async () => {
      const updatedEntity = { Id: 789, Name: 'Updated' };
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => updatedEntity
      } as any);

      const result = await service.updateEntity('Task', 789, { Name: 'Updated' });

      expect(result).toEqual(updatedEntity);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('comment methods', () => {
    describe('getComments', () => {
      it('should get comments for an entity', async () => {
        const mockResponse = {
          Items: [
            {
              Id: 207220,
              Description: 'Test comment',
              ParentId: null,
              CreateDate: '/Date(1752265210000+0200)/',
              IsPrivate: false,
              General: { Id: 54356, Name: 'Test Story' },
              Owner: { Id: 101732, FullName: 'Test User', Login: 'test@example.com' }
            }
          ]
        };

        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => mockResponse
        } as any);

        const result = await service.getComments('UserStory', 54356);

        expect(result).toEqual(mockResponse.Items);
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/UserStorys/54356/Comments'),
          expect.any(Object)
        );
      });

      it('should handle invalid entity type', async () => {
        await expect(service.getComments('InvalidType', 54356))
          .rejects
          .toThrow(McpError);
      });

      it('should handle API errors', async () => {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          json: async () => { throw new Error('not json'); }
        } as any);

        await expect(service.getComments('UserStory', 99999))
          .rejects
          .toThrow();
      });

      it('should retry on failure', async () => {
        mockFetch
          .mockResolvedValueOnce({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
            json: async () => { throw new Error('not json'); }
          } as any)
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ Items: [] })
          } as any);

        const result = await service.getComments('Task', 12345);

        expect(result).toEqual([]);
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });
    });

    describe('createComment', () => {
      it('should create a basic comment', async () => {
        const mockComment = {
          Id: 207221,
          Description: 'New comment',
          CreateDate: '/Date(1752265210000+0200)/',
          General: { Id: 54356 }
        };

        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => mockComment
        } as any);

        const result = await service.createComment(54356, 'New comment');

        expect(result).toEqual(mockComment);
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/Comments'),
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({
              General: { Id: 54356 },
              Description: 'New comment'
            })
          })
        );
      });

      it('should create a private comment', async () => {
        const mockComment = {
          Id: 207222,
          Description: 'Private comment',
          IsPrivate: true,
          General: { Id: 54356 }
        };

        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => mockComment
        } as any);

        await service.createComment(54356, 'Private comment', true);

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/Comments'),
          expect.objectContaining({
            body: JSON.stringify({
              General: { Id: 54356 },
              Description: 'Private comment',
              IsPrivate: true
            })
          })
        );
      });

      it('should create a reply comment', async () => {
        const mockReply = {
          Id: 207223,
          Description: 'Reply comment',
          ParentId: 207220,
          General: { Id: 54356 }
        };

        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => mockReply
        } as any);

        await service.createComment(54356, 'Reply comment', false, 207220);

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/Comments'),
          expect.objectContaining({
            body: JSON.stringify({
              General: { Id: 54356 },
              Description: 'Reply comment',
              ParentId: 207220
            })
          })
        );
      });

      it('should create a private reply comment', async () => {
        const mockReply = {
          Id: 207224,
          Description: 'Private reply',
          ParentId: 207220,
          IsPrivate: true,
          General: { Id: 54356 }
        };

        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => mockReply
        } as any);

        await service.createComment(54356, 'Private reply', true, 207220);

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/Comments'),
          expect.objectContaining({
            body: JSON.stringify({
              General: { Id: 54356 },
              Description: 'Private reply',
              IsPrivate: true,
              ParentId: 207220
            })
          })
        );
      });

      it('should handle API errors', async () => {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          json: async () => { throw new Error('not json'); }
        } as any);

        await expect(service.createComment(54356, 'Test comment'))
          .rejects
          .toThrow();
      });

      it('should retry on failure', async () => {
        const mockComment = { Id: 207225, Description: 'Retry comment' };

        mockFetch
          .mockResolvedValueOnce({
            ok: false,
            status: 503,
            statusText: 'Service Unavailable',
            json: async () => { throw new Error('not json'); }
          } as any)
          .mockResolvedValueOnce({
            ok: true,
            json: async () => mockComment
          } as any);

        const result = await service.createComment(54356, 'Retry comment');

        expect(result).toEqual(mockComment);
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });
    });

    describe('deleteComment', () => {
      it('should delete a comment successfully', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          status: 200
        } as any);

        const result = await service.deleteComment(207220);

        expect(result).toBe(true);
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/Comments/207220'),
          expect.objectContaining({ method: 'DELETE' })
        );
      });

      it('should handle delete failures', async () => {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          json: async () => { throw new Error('not json'); },
          text: async () => 'Comment not found'
        } as any);

        await expect(service.deleteComment(999999))
          .rejects
          .toThrow('Failed to delete comment 999999: 404 - Comment not found');
      });

      it('should handle unauthorized deletion', async () => {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          json: async () => { throw new Error('not json'); },
          text: async () => 'Insufficient permissions'
        } as any);

        await expect(service.deleteComment(207220))
          .rejects
          .toThrow('Failed to delete comment 207220: 403 - Insufficient permissions');
      });

      it('should retry on transient failures', async () => {
        mockFetch
          .mockResolvedValueOnce({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
            json: async () => { throw new Error('not json'); },
            text: async () => 'Temporary server error'
          } as any)
          .mockResolvedValueOnce({
            ok: true,
            status: 200
          } as any);

        const result = await service.deleteComment(207220);

        expect(result).toBe(true);
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });

      it('should not retry on 4xx errors', async () => {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          json: async () => { throw new Error('not json'); },
          text: async () => 'Invalid comment ID'
        } as any);

        await expect(service.deleteComment(99999))
          .rejects
          .toThrow();

        expect(mockFetch).toHaveBeenCalledTimes(1);
      });

      it('should handle network failures', async () => {
        mockFetch.mockRejectedValue(new Error('Network error'));

        await expect(service.deleteComment(207220))
          .rejects
          .toThrow();
      });
    });
  });
});
