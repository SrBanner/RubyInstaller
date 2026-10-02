# Changelog

## Não publicado

- O instalador fornece ao npm o caminho real da pasta temporária, evitando o erro de lockfile do npm 11 quando um diretório ancestral é um link simbólico, como em caminhos temporários do macOS.
- O teste de instalação cobre caminhos com espaços e ancestrais simbólicos, identifica cada etapa separadamente e reserva tempo para instalação e atualização sem antecipar o timeout do npm.

## 0.1.1 — 2026-10-02

- Corrigida a instalação no Windows: o script POSIX `npm` não é mais escolhido no lugar de `npm.cmd`.
- npm é iniciado pelo `npm-cli.js` usando o Node atual, com suporte ao npm distribuído com Node e aos wrappers npm no PATH.
- Wrappers Windows reconhecem `%~dp0` e `%dp0%`, sem confundir a chamada do cliente com uma verificação anterior de `node.exe`.
- Scripts PowerShell incluem BOM UTF-8 para leitura correta de acentos pelo Windows PowerShell 5.1.
- Erros de processos auxiliares identificam o comando e o código de falha, sem divulgar argumentos, entrada ou stderr potencialmente sensíveis.
- Adicionados 15 testes de regressão e execução do instalador PowerShell no teste de integração do CI Windows.

## 0.1.0 — 2026-10-02

- Instalador privado para Windows, macOS e Linux/WSL, com atualização e remoção separadas do estado.
- CLI RubyCLI com setup, modelos, chat, revisão, diagnóstico e teste explícito de API.
- Perfis separados para Codex CLI, Claude Code, OpenCode e Aider.
- Ponte local autenticada para Chat Completions, Messages e subconjunto de Responses.
- Streaming de texto, imagens e chamadas/retornos de funções; adaptação de custom tools textuais.
- MCP stdio com consultas, revisão, fila de jobs, cancelamento, recursos e prompt.
- Armazenamento de chave em ambiente, Chaves, Secret Service, DPAPI ou arquivo explícito.
- README em português, identidade RubyCLI, licenças/atribuições e CI multiplataforma.

Consulte `docs/VALIDATION.md` para o que foi executado e `docs/COMPATIBILITY.md` para os limites desta versão.
