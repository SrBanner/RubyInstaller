# Clientes e integrações

O aplicativo RubyCLI requer Node.js 22.16+. Cada cliente possui seus próprios requisitos; use a instalação suportada pelo fabricante. O instalador RubyCLI não instala nem atualiza esses programas.

| Cliente | Comando | Formato enviado à ponte | Diretório RubyCLI |
| --- | --- | --- | --- |
| Claude Code | `rubycli launch claude` | Messages | `clients/<perfil>/claude` |
| Codex CLI | `rubycli launch codex` | Responses, HTTP/SSE | `clients/<perfil>/codex` |
| OpenCode | `rubycli launch opencode` | Chat Completions | `clients/<perfil>/opencode` |
| Aider | `rubycli launch aider` | Chat Completions | `clients/<perfil>/aider` |

Na validação Linux desta entrega, Claude Code 2.1.287 concluiu uma resposta pela ponte com API simulada. O Codex CLI 0.160.0 selecionou o provider e o perfil corretos, mas não concluiu a inicialização dentro de 55 segundos neste ambiente, antes de enviar qualquer requisição à ponte. Assim, **Codex permanece experimental nesta release**, embora o adaptador Responses e seus contratos tenham testes locais. OpenCode/Aider têm configuração testada com fixtures, sem execução nativa nesta entrega.

Todos os caminhos são relativos a `RUBYCLI_HOME`, por padrão `~/.rubycli`. HOME, USERPROFILE, APPDATA e caminhos XDG do subprocesso apontam para a área RubyCLI. As configurações e credenciais pessoais dos clientes não são copiadas. Variáveis conhecidas de autenticação/roteamento desses clientes são retiradas do subprocesso e substituídas pelas definições RubyCLI.

O ambiente de trabalho e arquivos de projeto não são isolados por uma sandbox. Isso permite que o cliente trabalhe no projeto escolhido, usando suas aprovações normais. O cliente pode gravar histórico e dados sensíveis na área RubyCLI. Configure permissões e retenção conforme seu ambiente.

## Codex CLI

```sh
rubycli launch codex
rubycli launch codex -- --help
rubycli launch codex -- exec --sandbox read-only "Explique este projeto"
```

O provider `rubycli` usa `wire_api=responses`, `requires_openai_auth=false` e uma credencial local. Essas são opções de configuração do provider; não concedem acesso à OpenAI, não reaproveitam assinaturas e não desativam permissões de ferramentas. Web search é desativado nessa integração porque a ponte não implementa a ferramenta de servidor.

Metadados de contexto de modelos externos podem não ser conhecidos pelo Codex. Esta versão não inventa limites de contexto nem preços. A seleção do modelo não significa certificação de que ele segue o formato das ferramentas do cliente.

## Claude Code

```sh
rubycli launch claude
rubycli launch claude -- -p "Responda somente OK"
```

`CLAUDE_CONFIG_DIR` aponta ao perfil RubyCLI. `ANTHROPIC_BASE_URL` aponta à ponte local. O modelo escolhido também é aplicado aos aliases de tarefas auxiliares para evitar uma troca silenciosa para um modelo não escolhido. A descoberta do catálogo pelo gateway é habilitada.

Recursos específicos de Claude, como thinking com assinatura, contagem nativa de tokens e ferramentas de servidor, não são equivalentes em Chat Completions. O modelo externo precisa atender à carga real de ferramentas do cliente. A chave RubyCLI e créditos válidos continuam obrigatórios.

## OpenCode

O launcher passa um provider `rubycli` baseado em `@ai-sdk/openai-compatible`, com configuração no ambiente da sessão e diretórios próprios. O OpenCode pode instalar esse adaptador no primeiro uso conforme o funcionamento do próprio cliente.

Para integrar **MCP ao OpenCode normal**, use a estrutura `mcp`, não cole o JSON `mcpServers` literalmente. Gere `rubycli mcp-config`, aproveite os caminhos retornados e adapte:

```json
{
  "mcp": {
    "rubycli": {
      "type": "local",
      "command": ["CAMINHO_ABSOLUTO_DO_NODE", "CAMINHO_ABSOLUTO_DO_RUBYCLI_MCP_MJS", "--profile", "default"],
      "environment": { "RUBYCLI_HOME": "CAMINHO_ABSOLUTO_DO_ESTADO_RUBYCLI" },
      "enabled": true
    }
  }
}
```

Os placeholders são campos para substituir com a saída local; não são caminhos utilizáveis.

## Aider

O launcher define base URL, chave temporária, configuração vazia, dotenv vazio e históricos separados. O modelo é selecionado como `openai/ID`. A qualidade das edições e o formato de diff dependem do modelo e da versão do Aider. Consulte a documentação do cliente para ajustes de edição; esta versão não adivinha metadados por nome.

## Claude Desktop, Cursor e outros clientes MCP

1. Execute `rubycli mcp-config` em uma instalação estável.
2. Adicione a entrada `rubycli` ao objeto `mcpServers` existente.
3. Garanta acesso ao cofre do usuário ou à variável de ambiente da chave.
4. Reinicie o cliente e confirme a presença de `ruby_models` e `ruby_ask`.

Para Codex, `rubycli mcp-config --format codex` gera a entrada TOML. O timeout de ferramenta é 600 segundos; use jobs para separar consulta e acompanhamento.

O MCP usa stdio: stdout contém somente mensagens do protocolo. O processo recebe a configuração do perfil; nunca use o output de `setup` como servidor MCP.

## Windows, WSL e executáveis

- A instalação nativa gera `.cmd` e `.ps1` próprios da RubyCLI.
- O launcher reconhece executáveis nativos e shims npm Node, resolvendo o entrypoint sem executar uma string arbitrária via shell.
- Wrappers `.cmd`/`.bat` personalizados que não sejam shims Node reconhecidos são recusados. Use `--bin` apontando a um `.exe` suportado.
- WSL e Windows são ambientes diferentes. Instale Node, RubyCLI e o cliente no mesmo ambiente. Não misture caminhos `C:\...` com caminhos Linux no mesmo launcher.
- Windows e macOS têm configuração/CI preparados, mas a execução nativa desses sistemas não foi realizada no ambiente Linux usado para montar esta entrega.

## Fontes oficiais consultadas

- [RubyCLI API](https://app.rubycli.cloud/docs)
- [Codex: gateway](https://developers.openai.com/codex/enterprise/connect-to-a-gateway)
- [Codex: configuração](https://developers.openai.com/codex/config-reference)
- [Claude Code: variáveis](https://code.claude.com/docs/en/env-vars)
- [Claude Code: protocolo de gateway](https://code.claude.com/docs/en/llm-gateway-protocol)
- [OpenCode: providers](https://opencode.ai/docs/providers/)
- [Aider: OpenAI compatível](https://aider.chat/docs/llms/openai-compat.html)

Consulta realizada em 2 de outubro de 2026 (UTC). Versões e protocolos dos clientes podem evoluir.
