# Contrato de compatibilidade — 0.1.1

A documentação pública RubyCLI consultada oferece `GET /v1/models` e `POST /v1/chat/completions`, incluindo SSE. Ela não declara endpoints Messages ou Responses. Por isso estes formatos são adaptados **localmente**, sem presumir que existam no servidor RubyCLI.

## Matriz

| Recurso | Estado nesta versão |
| --- | --- |
| Catálogo autenticado | Consulta à API; nenhum ID de modelo embutido. |
| Texto Chat Completions | Direto, não streaming ou SSE. |
| Messages: texto e system | Traduzidos para mensagens Chat Completions. |
| Responses: input textual/lista, instructions | Traduzidos para mensagens Chat Completions. |
| Imagem | URL/data URL e blocos base64; suporte final depende do modelo. |
| Function tools | Definição, chamada, argumentos e retorno com call_id preservado. |
| Custom tools de Responses | Convertidas em funções com parâmetro `input` textual e reconvertidas na saída. Não há validação da gramática original. |
| Streaming textual | Incremental; erros e streams incompletos não recebem uma conclusão de sucesso. |
| Streaming de argumentos de tools | Argumentos são acumulados e validados antes de publicar o bloco completo. |
| Usage | Contagens informadas pelo provedor, quando disponíveis; não é saldo em Ruby Units. |
| Responses previous_response_id | Memória local limitada a 50 respostas / 32 MiB / 10 minutos; não existe após reiniciar a ponte. `store:false` desabilita essa retenção para a chamada. |
| Saída JSON/schema | Campos repassados quando possíveis; depende da API/modelo. |
| Raciocínio | Blocos anteriores de reasoning/thinking não são reenviados entre protocolos. Não são fabricadas assinaturas, raciocínio ou tokens. Opções de esforço/orçamento não são traduzidas. |
| Web search, computer use, ferramentas de servidor | Não suportados; rejeitados quando solicitados como tools. |
| Arquivos/PDF via file_id, áudio e vídeo | Não suportados. |
| Responses compact, WebSockets, background | Não suportados. Use contexto completo por HTTP; para consultas assíncronas use jobs MCP. |
| Messages count_tokens | Não implementado; não é retornada uma contagem inventada. |
| Clientes de celular/browser | Não constituem um alvo nativo do instalador. Podem acessar sua API diretamente se forem compatíveis; a ponte local rejeita origens web. |

## Limites operacionais

- Ponte vinculada exclusivamente a `127.0.0.1`; sem modo público/LAN.
- Autenticação local obrigatória, separada da chave RubyCLI.
- Máximo de 4 gerações simultâneas por ponte; excesso recebe erro 429.
- Corpo de entrada até 16 MiB; resposta até 32 MiB; evento SSE até 2 MiB.
- Timeout de chamada à API de 5 minutos. A desconexão do cliente cancela a requisição em andamento.
- Sem retry automático de gerações. Uma geração interrompida já pode ter sido cobrada; uma nova tentativa é uma nova chamada.
- Redirects da API são recusados para não encaminhar credenciais a outra origem.
- HTTP permitido somente para loopback; endpoints remotos exigem HTTPS.
- Configurações por projeto e políticas do cliente ainda se aplicam. Isolar estado não equivale a restringir os acessos de todo o processo.

## O que verificar com uma conta real

Execute `rubycli verify --model ID_DO_CATALOGO` para verificar texto, SSE e uma chamada de função. Depois teste uma tarefa pequena no cliente escolhido. Essas chamadas consomem créditos da plataforma. Uma boa validação operacional inclui:

1. Resposta simples no terminal.
2. Chamada de ferramenta com argumentos válidos.
3. Devolução do resultado da ferramenta e resposta final no cliente.
4. Cancelamento, contexto longo e mensagens de erro do modelo escolhido.

Não há chave real no repositório ou no ZIP. Os testes automatizados padrão usam servidor local simulado e não consomem créditos.
