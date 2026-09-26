import { TokenService } from '../auth/token-service.js';
import { AuthService } from './auth-service.js';
import { UserService } from './user-service.js';
import { ProjectService } from './project-service.js';
import { StorageService } from './storage-service.js';
import { RoomService } from './room-service.js';
import { DesignService } from './design-service.js';
import { AiService } from './ai-service.js';

export function createServices(pool, config, overrides = {}) {
  const tokenService = overrides.tokenService || new TokenService(config);
  const storage = overrides.storage || new StorageService(config);
  const ai = overrides.ai || new AiService(config);
  return {
    tokenService,
    storage,
    ai,
    auth: overrides.auth || new AuthService(pool, tokenService, config.credits.initial),
    users: overrides.users || new UserService(pool),
    projects: overrides.projects || new ProjectService(pool),
    rooms: overrides.rooms || new RoomService(pool, storage),
    designs: overrides.designs || new DesignService(pool, storage, config.credits),
  };
}

