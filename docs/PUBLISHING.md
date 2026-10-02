# Publicar no GitHub

Este ZIP é um projeto pronto para versionar, com README, logo, licença, dependências travadas, testes e workflows. Nenhum repositório ou pacote npm foi publicado automaticamente.

## 1. Crie o repositório

No GitHub da RubyCLI, crie um repositório vazio com o nome desejado, por exemplo `rubycli-installer`. Extraia o ZIP e envie **o conteúdo da pasta `rubycli`**, não o ZIP como único arquivo do repositório.

Pelo terminal, na raiz extraída:

```sh
git init
git add .
git commit -m "feat: RubyCLI installer, bridge and MCP"
git branch -M main
```

Adicione o remote usando a URL exata que o GitHub fornecer e faça push da branch `main`. O nome da organização não foi presumido neste projeto.

## 2. Confira o CI

O workflow `CI` instala dependências sem scripts e executa sintaxe e testes em Linux, macOS e Windows, com Node 22 e 24. Ele não precisa de chave da RubyCLI. Aguarde os resultados antes de anunciar suporte nativo das plataformas não verificadas localmente.

Os testes de clientes reais são opcionais e usam API simulada. Consulte `docs/VALIDATION.md`. Para homologação da API real, use uma chave de teste com crédito e execute `rubycli verify` localmente; não inclua credenciais em issues ou logs.

## 3. Gere uma release

O workflow `Package` é manual (`workflow_dispatch`), não publica no npm nem cria releases automaticamente. Ele produz os arquivos distribuíveis e um SHA-256 como artifacts da execução. Baixe esses arquivos e anexe à sua release do GitHub depois de revisar a versão.

Também é possível empacotar localmente:

```sh
npm ci --ignore-scripts
npm run check
npm test
npm pack
```

O `.tgz` gerado pode ser instalado com `npm install -g ./ARQUIVO_GERADO.tgz` se o usuário preferir instalação npm global. O instalador `install.sh`/`install.ps1` mantém sua própria área privada e não precisa de instalação global.

No Windows, o instalador adiciona o diretório `bin` privado ao PATH do usuário por padrão. Para instalações temporárias ou portáteis, use `install.ps1 -NoPath` ou `node scripts/install.mjs --no-path`. O instalador mantém as outras entradas e registra a entrada adicionada para removê-la na desinstalação.

## 4. Distribua os comandos corretos

Quando houver uma URL pública real, acrescente ao README o clone do seu repositório e a URL de Releases. Evite anunciar `npx @rubycli/installer` antes de o pacote existir sob controle da sua organização.

## Publicação npm opcional

1. Confirme que a organização npm `@rubycli` pertence à sua equipe. Se não pertencer, ajuste `name` no `package.json` e atualize o lockfile com `npm install --package-lock-only --ignore-scripts`.
2. Adicione `repository` e `bugs` com a URL real do seu GitHub.
3. Revise `npm pack --dry-run`; não devem aparecer chaves, `.env`, `node_modules` ou diretórios de estado.
4. Autentique-se no npm usando o procedimento oficial da sua organização.
5. Faça a publicação conscientemente com `npm publish --access public`.

O uso das marcas RubyCLI e dos assets fornecidos é separado da licença MIT do código. Preserve os avisos de terceiros na publicação.
