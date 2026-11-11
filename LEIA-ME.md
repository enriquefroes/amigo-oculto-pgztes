# Amigo Oculto Pgzetes

Site de amigo oculto de camisas de futebol: cada membro cria conta, preenche tamanho, time do coração e times vetados, e vê só quem tirou.

## Como publicar no Netlify

O site usa Netlify Functions e Netlify Blobs (o "banco" do próprio Netlify), então ele precisa passar pelo build do Netlify. Arrastar a pasta no painel não basta.

**Opção A: GitHub (mais fácil)**
1. Crie um repositório no GitHub e suba esta pasta inteira.
2. No Netlify: Add new site → Import an existing project → escolha o repositório. As configurações já vêm do `netlify.toml`, é só confirmar.

**Opção B: Netlify CLI**
```
npm install
npx netlify-cli login
npx netlify-cli deploy --prod
```

## Variáveis de ambiente (obrigatórias)

No Netlify: Site configuration → Environment variables. Depois de criar, faça um novo deploy.

| Nome | O que colocar |
|---|---|
| `SESSION_SECRET` | Um texto longo e aleatório, com 32 caracteres ou mais. Ninguém precisa saber. |
| `GROUP_CODE` | O código que você manda no grupo para a galera conseguir criar conta. Ex.: `pgz-natal-2026` |
| `ADMIN_USER` | O usuário que você vai criar no site (em minúsculas). Essa conta vê a Área do organizador. |

## Passo a passo do organizador

1. Publique e configure as 3 variáveis.
2. Entre no site e crie sua conta com o mesmo usuário que colocou em `ADMIN_USER`.
3. Mande no grupo o link e o código do grupo.
4. Quando todo mundo tiver ficha completa, clique em **Fazer o sorteio**.
5. Esqueceram a senha? Na lista, clique em **Resetar senha** e mande a senha temporária para a pessoa. Se o sorteio já tiver sido feito, refaça depois que ela entrar.

## Como o segredo funciona

- Cada membro tem uma chave criada no próprio celular e trancada com a senha dele.
- O sorteio é feito no servidor, num único círculo embaralhado (ninguém tira a si mesmo). Cada resultado é trancado na hora com a chave do participante e nada volta para o organizador.
- O servidor só guarda resultados trancados, então nem o organizador (que também participa) nem quem acessa o painel do Netlify consegue ver quem tirou quem.

## Dica para a galera

No celular, abra o link e use "Adicionar à tela inicial" (Safari: botão de compartilhar; Chrome: menu ⋮). O app abre como um aplicativo.
- Resetar a senha de alguém troca a chave dessa pessoa, por isso o sorteio precisa ser refeito.
