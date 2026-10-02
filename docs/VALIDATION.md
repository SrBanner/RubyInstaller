# Validação da entrega 0.1.1

Data: **2 de outubro de 2026, UTC**. Ambiente de execução: Linux x64, Node.js 24.19.0, npm 11.9.0.

## Executado

| Verificação | Resultado |
| --- | --- |
| `npm run check` | Sintaxe de todos os módulos e testes verificada. |
| Suíte automatizada padrão | 91 testes: 89 aprovados, nenhum reprovado e 2 testes de clientes reais ignorados por serem opt-in. |
| Correção Windows 0.1.1 | 15 novas regressões aprovadas: seleção de executável, npm junto ao Node, npm.cmd oficial, cmd-shim, argumentos literais, alvos ausentes, mensagens de erro e bytes do instalador PowerShell. Resolução Windows exercitada com sistema de arquivos simulado. |
| API local simulada | Catálogo, autenticação, texto, SSE UTF-8 fragmentado, ferramentas, erros, redirect e interrupção. |
| Adaptador Messages | Texto, mensagens system usadas pelo Claude atual, imagens, chamadas/retornos de funções e ordem de eventos. |
| Adaptador Responses | Texto, SSE, IDs, usage, funções, custom tools textuais e contexto de continuação em memória. |
| Ponte local | Token obrigatório, rejeição de Origin/Host indevidos e endpoints não suportados. |
| Isolamento | Configurações oficiais fictícias preservadas byte a byte para quatro clientes; remoção de credenciais herdadas do subprocesso. |
| Launcher | Executável simulado recebe argumentos literais, mantém código de saída e remove o perfil temporário. |
| MCP | Cliente do SDK conectado a subprocesso stdio real: descoberta, consulta, fila, resultado, erro, recursos e prompts. |
| Instalador | Instalação real em caminho com espaços, dependências via lockfile, atualização, comando instalado, recusa de conflito e remoção preservando dados. |
| Fila MIT adaptada | Testes de concorrência, cancelamento, TTL, recuperação e encerramento do upstream incluídos. Persistência da fila não é ativada pela aplicação. |
| Dependências | Instalação limpa com o lockfile concluída na 0.1.1. Auditoria feita na 0.1.0: nenhuma vulnerabilidade reportada; versões das dependências não foram alteradas na 0.1.1. Isso não é uma garantia permanente. |
| Pacote npm | `npm pack --dry-run` concluído; 35 arquivos, sem node_modules ou arquivos .env. |
| Claude Code 2.1.287 real, na 0.1.0 | Resposta de texto concluída pela ponte contra API simulada, em perfil temporário próprio. Nenhuma conta real usada. Não repetido nesta correção. |
| Codex CLI 0.160.0 real, na 0.1.0 | Provider RubyCLI e perfil próprio selecionados, mas inicialização não concluiu no limite de 55 s e nenhuma chamada chegou à ponte. Fluxo ponta a ponta não validado; suporte experimental. Não repetido nesta correção. |

Na 0.1.1, a instalação local, atualização e remoção foram repetidas em Linux. A suíte de instalação utiliza um cache npm previamente preenchido com as dependências do lockfile para exercitar `--offline`. No CI Windows, esse mesmo teste agora chama `install.ps1` pelo Windows PowerShell e verifica o launcher PowerShell instalado. Esse caminho nativo está preparado, mas não foi executado neste ambiente.

A correção responde ao relato de falha da 0.1.0 no Windows: a busca podia selecionar o script POSIX `npm` que acompanha `npm.cmd`, causando falha ao iniciar o processo. A 0.1.1 inicia o `npm-cli.js` pelo Node e inclui BOM UTF-8 nos arquivos PowerShell. Os testes verificam esses mecanismos; não substituem a execução no computador do usuário.

O teste do Claude expôs o uso de mensagens `system` na lista `messages` da versão atual. O adaptador foi corrigido e ganhou um teste de regressão específico.

Os testes de Codex demonstraram seleção do provider correto nos logs, mas não permitem concluir a causa da espera. Não foram removidas políticas gerenciadas, trocadas credenciais ou desabilitadas aprovações para fazer o teste passar. Nos testes de texto, plugins/apps opcionais foram desativados apenas no processo de teste para reduzir inicializações externas; essa opção não é imposta pelo launcher de produção.

## Não executado / ainda depende da homologação

- Nenhuma geração contra a API de produção RubyCLI: não foi fornecida uma chave de teste.
- Não há certificação de todos os modelos, preços, limites de contexto, imagens ou qualidade de edição.
- Nenhuma execução nativa em Windows ou macOS. Scripts e CI foram preparados; o workflow precisa ser executado no seu GitHub.
- Cofres macOS/Windows/Linux desktop não foram exercitados neste Linux headless. O fluxo por variável e por arquivo foi testado.
- OpenCode e Aider não foram executados nativamente; perfis e parâmetros têm fixtures locais.
- Os testes com executável real do Claude cobrem resposta de texto; ciclos reais de ferramentas/edições dependem de homologação adicional.

## Repetir

No Windows, os testes de instalação usam `--no-path` ou `-NoPath` para não registrar o prefixo temporário no PATH do usuário. Os testes do PATH cobrem preservação das entradas existentes, diretórios equivalentes sem duplicatas, remoção e tipos do registro. A ponte PowerShell é exercitada em uma chave temporária isolada, sem alterar o PATH real.

Validação local da configuração automática do PATH, em 2026-10-02: Windows, Node.js 24.11.1 e npm 11.19.0; 104 testes aprovados, 3 ignorados e nenhuma falha. A sintaxe e o empacotamento também passaram. Uma atualização real da instalação confirmou que somente a pasta `bin` foi acrescentada ao PATH do usuário, preservando o texto anterior e o tipo do registro; `rubycli --version` retornou `0.1.1` no CMD e no PowerShell iniciados com o ambiente atualizado. Isso não substitui a validação da matriz remota do GitHub Actions.

```sh
npm ci --ignore-scripts
npm run check
npm test
sh -n install.sh
npm pack --dry-run
```

Para executar testes opcionais com clientes reais já instalados, **contra uma API simulada local**:

```sh
RUBYCLI_TEST_CLAUDE_BIN=/caminho/absoluto/claude node --test test/real-clients.test.mjs
RUBYCLI_TEST_CODEX_BIN=/caminho/absoluto/codex node --test test/real-clients.test.mjs
```

No PowerShell, defina a variável com `$env:RUBYCLI_TEST_CLAUDE_BIN = 'C:\caminho\claude.exe'` antes do comando Node. Esses testes não instalam os clientes e não usam a chave da plataforma. Eles exercitam subprocessos reais; os clientes podem fazer verificações de atualização/telemetria próprias.

Para API de produção, configure um perfil de homologação e execute `rubycli verify --profile homologacao --model ID`. São três chamadas cobradas e nenhum comando do modelo é executado. Confira também uma tarefa pequena no cliente antes de divulgar compatibilidade com determinado modelo.
