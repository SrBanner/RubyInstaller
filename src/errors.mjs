export class RubyError extends Error {
  constructor(code, message, status = 400) { super(message); this.name = 'RubyError'; this.code = code; this.status = status; }
}
export function assert(condition, code, message, status = 400) {
  if (!condition) throw new RubyError(code, message, status);
}
export function safeError(error) {
  if (error instanceof RubyError) return { code: error.code, message: error.message, status: error.status };
  if (['AbortError', 'TimeoutError'].includes(error?.name)) return { code: 'CANCELLED_OR_TIMEOUT', message: 'Requisição cancelada ou tempo limite atingido.', status: 504 };
  // Provider bodies, command stderr and system errors can contain credentials.
  return { code: 'INTERNAL_ERROR', message: 'A operação falhou. Execute rubycli doctor para verificar a configuração.', status: 500 };
}
