/**
 * Programmatic ("headless") surface of @srcbook/api.
 *
 * The default entrypoint (index.mjs) only exposes the HTTP/WebSocket servers.
 * This subpath re-exports the internal building blocks that an embedding
 * program (e.g. @kastalien-research/glassbook) needs to create notebooks,
 * manage sessions, run cells, and talk to the configured LLM provider, without
 * standing up the web server.
 *
 * Importing this module triggers the same side effects as @srcbook/api
 * (SQLite init + migrations, config bootstrap) because the secrets/config and
 * model layers depend on the database.
 */

// srcmd encode/decode
export { encode, decode, decodeCells, decodeDir } from './srcmd.mjs';

// notebook directory lifecycle (disk)
export {
  createSrcbook,
  removeSrcbook,
  writeToDisk,
  writeCellToDisk,
  importSrcbookFromSrcmdText,
} from './srcbook/index.mjs';

// in-memory session lifecycle
export {
  createSession,
  findSession,
  listSessions,
  addCell,
  updateSession,
  updateCell,
  insertCellAt,
  replaceCell,
  removeCell,
  findCell,
  exportSrcmdText,
  sessionToResponse,
} from './session.mjs';

// child-process execution primitives
export { node, tsx, npmInstall, spawnCall } from './exec.mjs';

// LLM provider/model resolution (reads provider + key from SQLite config)
export { getModel } from './ai/config.mjs';

// app config + secrets
export { getConfig, updateConfig, getSecretsAssociatedWithSession } from './config.mjs';

// constants
export { SRCBOOK_DIR, SRCBOOKS_DIR } from './constants.mjs';

// types
export type { SessionType } from './types.mjs';
