# Segurança

Para relatar um problema, use o recurso **Private vulnerability reporting** do repositório GitHub se estiver habilitado. Caso não esteja, entre em contato com a equipe pelo suporte no [painel RubyCLI](https://app.rubycli.cloud). Nunca publique chaves ou dados de clientes em uma issue pública.

## Modelo de segurança

- O instalador escreve somente na área selecionada e não usa privilégios administrativos.
- A chave RubyCLI não é incluída no código, snippets MCP ou argumentos dos subprocessos.
- O launcher usa um token local efêmero e uma ponte vinculada a loopback. CORS, origens de navegador, hosts inesperados e chamadas sem autenticação são recusados.
- Credenciais de clientes existentes não são usadas como fallback.
- Gerações falhas não são repetidas automaticamente para evitar duplicar chamadas cobradas.
- O código não ativa bypass de permissões dos clientes e não remove políticas corporativas.
- MCP não executa shell, lê arquivos locais ou aplica mudanças. `review --file` é um comando explícito do usuário que envia o arquivo indicado à API.
- Logs de uso RubyCLI contêm metadados de tokens, não prompts/respostas. Históricos dos clientes e arquivos de projeto têm seu próprio ciclo de vida.

Isso não isola processos do mesmo usuário do sistema operacional. Outro processo com os mesmos privilégios pode ler ambiente, arquivos acessíveis e memória conforme as proteções do sistema. O armazenamento `file` é texto legível; use cofre ou variável de ambiente conforme seu cenário.

Não exponha a ponte em um reverse proxy público. Não use o instalador como barreira multiusuário ou serviço de revenda na rede. O endpoint remoto recebe os prompts enviados; as regras da plataforma/provedor continuam aplicáveis.

O lockfile fixa integridades das dependências e os instaladores usam `npm ci --ignore-scripts`. Atualizações dependem de uma nova versão do projeto; não há atualização remota automática ou execução de shell recebida da API.
