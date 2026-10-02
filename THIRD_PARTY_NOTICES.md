# Origem e atribuições

## quebragalho-bridge — código adaptado

- Autor: **Eduardo D'anjour**.
- Repositório: https://github.com/danjour/quebragalho-bridge
- Commit consultado: `67b292082d64079fb78f13687f7edf9ce7748ad3`.
- Licença: **MIT**, preservada integralmente em `src/vendor/LICENSE.quebragalho-bridge`.
- Arquivos derivados: `src/vendor/job-queue.mjs` e `test/vendor-job-queue.test.mjs`.
- Alterações: prefixos de ambiente `QUEBRAGALHO_` passaram a `RUBYCLI_`, marcador interno de jobs passou a `rubycli-job-v1` e o import dos testes foi atualizado. A aplicação usa a fila com persistência desativada e execução de consultas à API.

O projeto também serviu como referência conceitual para ferramentas MCP, jobs e diário restrito a contadores. O diário RubyCLI foi reimplementado sem preços estáticos, política financeira baseada em preços de outro provedor ou fallback para credenciais de clientes.

Os executores originais de agentes, alterações de permissões, memória compartilhada e regras automáticas para hosts não foram incorporados. Na RubyCLI, a ponte traduz protocolos; ferramentas MCP retornam texto e não executam ações locais.

## quebragalho-installer — referência de design

- Autor/conta: **nikolasdehor**.
- Repositório: https://github.com/nikolasdehor/quebragalho-installer
- Commit consultado: `8c5939e73abfb110659e8f3906e85dcd3ce3f848`.
- Licença: não havia arquivo de licença ou declaração no package.json do snapshot consultado.

Foram usados os conceitos públicos de launcher com escolha de cliente, catálogo e perfis isolados. O código do instalador, scripts e testes desse repositório não são redistribuídos neste pacote; a implementação RubyCLI é independente. Esta referência não atribui uma licença ao código original nem implica endosso do autor.

## RubyCLI: identidade e contrato da API

- Documentação: https://app.rubycli.cloud/docs
- Assets fornecidos pelo site oficial: `/brand/ruby-mark.png` e `/brand/rubycli-horizontal-light.png`.
- Cores: fundo `#050304`, superfícies `#0f090c`, rubi `#e0115f`, destaque `#de0068` e texto `#f7eff3`.

Logotipos e marcas pertencem à RubyCLI e não recebem uma licença de marca pelo simples uso da licença MIT do código. Os assets foram incluídos a pedido da empresa.

## Dependências

O pacote usa `@modelcontextprotocol/sdk` 1.29.0, licenciado sob MIT. As versões transitivas e suas integridades estão no `package-lock.json`; os pacotes mantêm os próprios arquivos de licença ao serem instalados. Clientes Codex, Claude Code, OpenCode e Aider não são redistribuídos no ZIP.

As referências técnicas estão em `docs/CLIENTS.md`. A identidade visual e o instalador não constituem vínculo comercial ou endosso das empresas responsáveis pelos clientes.
