# Operação

## Estrutura de dados

| Caminho sob `~/.rubycli` | Conteúdo |
| --- | --- |
| `bin/` | Comandos gerados pelo instalador. |
| `app/<versão-id>/` | Código e dependências da instalação. |
| `installation.json` | Identificação da instalação e versão anterior. |
| `profiles/<nome>/config.json` | Endpoint e modelo padrão; sem chave. |
| `profiles/<nome>/config.json.backup` | Última configuração anterior; sem chave. |
| `profiles/<nome>/credential.json` | Referência ao cofre, blob DPAPI ou chave em texto se você escolheu `file`. |
| `profiles/<nome>/usage/AAAA-MM-DD.jsonl` | Contadores locais de chamadas e tokens; dia UTC. |
| `clients/<nome>/<cliente>/` | Estado e históricos mantidos pelo próprio cliente RubyCLI. |

O diretório de instalação e o de estado podem ser diferentes: `--prefix` escolhe o aplicativo; `RUBYCLI_HOME` escolhe estado. O MCP gerado fixa o caminho do estado para que aplicativos gráficos usem o mesmo perfil.

## Variáveis

| Variável | Efeito |
| --- | --- |
| `RUBY_API_KEY` | Chave injetada no ambiente; tem precedência sobre a salva. |
| `RUBYCLI_API_KEY` | Alias de `RUBY_API_KEY`; valores diferentes entre as duas causam erro. |
| `RUBYCLI_HOME` | Pasta de estado. Padrão: `.rubycli` no perfil do usuário. |
| `RUBYCLI_BASE_URL` | Override explícito de endpoint. Uma chave salva para outra URL não é usada. |
| `RUBYCLI_MODEL` | Modelo padrão do processo. |
| `RUBYCLI_USAGE=0` | Desativa o diário de contadores locais. |
| `RUBYCLI_LOCAL_TOKEN` | Credencial local de no mínimo 24 caracteres para `rubycli bridge` manual. O launcher gera a sua automaticamente. |
| `NO_COLOR=1` | Desativa as cores do menu. |
| `RUBYCLI_AGENT_MAX_CONCURRENCY` | Concorrência da fila MCP: 1 a 8; padrão do aplicativo 2. |
| `RUBYCLI_JOB_TTL_MS` | Prazo de metadados de jobs, em ms; padrão 1800000. |
| `RUBYCLI_JOB_RESULT_TTL_MS` | Prazo dos resultados; padrão 600000 ms. |

A fila adaptada contém suporte interno a persistência, mas o aplicativo RubyCLI não o ativa nesta versão. Prompts/resultados de jobs permanecem em memória. Não trate `ruby_usage` como relatório financeiro: chamadas de outros aplicativos, gerações abortadas ou sem usage não podem ser contabilizadas integralmente nesse diário. O saldo oficial é o da plataforma.

## Diagnóstico

| Sintoma | Ação |
| --- | --- |
| `rubycli` não encontrado | Use o caminho completo mostrado pelo instalador e adicione `bin` ao PATH. |
| `CLIENT_NOT_FOUND` | Instale o cliente pelo fabricante ou informe `--bin CAMINHO`. |
| `AUTH_REQUIRED` | Execute setup ou injete `RUBY_API_KEY` no processo. |
| `API_401` | Verifique se a chave está ativa no painel. |
| `API_402` | Verifique créditos/plano na plataforma. |
| `API_429` | Aguarde o limite do provedor; não há retry automático. |
| `CREDENTIAL_ENDPOINT_MISMATCH` | Refaça o setup do perfil para a URL escolhida. |
| `CREDENTIAL_UNAVAILABLE` | Desbloqueie o cofre. Em servidor headless, use variável de ambiente. |
| `MODEL_NOT_FOUND` | Consulte `rubycli models` e refaça a seleção. |
| `TRUNCATED_STREAM` | Geração interrompida pelo provedor/rede; confira consumo no painel antes de repetir. |
| `UNSUPPORTED_TOOL` / `UNSUPPORTED_CONTENT` | Consulte a matriz. O modelo/cliente está pedindo um recurso fora do adaptador. |
| `PREVIOUS_RESPONSE_NOT_FOUND` | Envie histórico completo; contexto local expirou, foi descartado ou usou `store:false`. |
| MCP não conecta | Use caminhos absolutos de `mcp-config`, reinicie o host e confira chave/cofre no ambiente dele. |
| Windows informa `UNSUPPORTED_SHIM` | Use um `.exe` ou um shim Node padrão instalado pelo npm. |

`rubycli doctor --json` produz um diagnóstico sem chave ou texto de prompts. `doctor --offline` não consulta rede. Compartilhe apenas diagnósticos que você revisou; caminhos de usuário e nomes de modelos podem ser dados internos.

## Atualização e recuperação

O instalador prepara uma pasta nova, instala dependências usando o lockfile e `--ignore-scripts`, e só depois troca os launchers RubyCLI. A pasta da versão anterior é mantida. Os comandos existentes de outros aplicativos nunca são substituídos.

Se uma atualização não funcionar, execute o instalador a partir de um ZIP anterior. Isso recria os launchers e preserva os perfis. Não apague a pasta de uma versão enquanto um cliente ou uma conexão MCP aponta para ela. Como o MCP usa caminhos absolutos, gere seu trecho novamente após mudar instalação/versão.

O instalador preserva versões antigas por segurança. A desinstalação automática remove a versão atual e a anterior identificadas; outras versões antigas podem permanecer em `app/`. Revise a pasta e remova manualmente versões sem uso.

Use `logout --yes` antes de apagar um perfil com chave em cofre, para remover também a entrada correspondente. Para revogar acesso de fato, revogue a chave no painel. Apagar arquivos locais não revoga uma chave remota.

## Ponte manual

Defina um token local aleatório de pelo menos 24 caracteres no ambiente e execute `rubycli bridge --port 8787`. Clientes de API locais devem enviar esse token em `Authorization: Bearer` ou `x-api-key`. Não envie a chave RubyCLI como token local.

Endpoints: `/health`, `/v1/models`, `/v1/chat/completions`, `/v1/messages`, `/v1/responses`. Todos exigem autenticação. Não há CORS para navegador, exposição pública, painel HTTP ou daemon instalado pelo sistema. Ctrl+C encerra a ponte.
