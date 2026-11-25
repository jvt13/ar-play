# AR Play — v1.0.1 (MVP)

Aplicativo web de personagens 3D interativos, inspirado na experiência de câmera com efeitos de realidade aumentada. Não é uma reprodução do TikTok. Os três personagens (Bip, Nori e Luma) são construídos proceduralmente, sem baixar modelos ou usar ativos proprietários.

## Modos

- **Estúdio 3D**: demonstração sem câmera. Funciona em navegador com WebGL.
- **Câmera criativa**: câmera frontal/traseira + personagens 3D compostos em um canvas, foto PNG e vídeo WebM/MP4 conforme os codecs disponíveis. Não rastreia superfícies físicas. Vídeo sem áudio.
- **AR espacial**: usa WebXR `immersive-ar`, `hit-test` e `dom-overlay` sobre ARCore. Detecta superfícies horizontais e posiciona um personagem em coordenadas do mundo durante a sessão. O personagem pode ser movido em um plano horizontal, sem colisão nem oclusão por objetos reais. Foto e vídeo são desabilitados neste modo. A gravação de tela do próprio Android é uma alternativa a testar, não um recurso do aplicativo.

## Executar no computador

Requisitos: Node.js 18+ e navegador com WebGL. Nenhuma dependência npm.

Na pasta ARPlay, execute `npm start`. Abra `http://localhost:8080` no navegador. Não precisa executar `npm install`. Para encerrar o servidor, Ctrl+C. A porta pode ser configurada pela variável de ambiente PORT.

## Executar no Android

1. Abra a URL HTTPS do GitHub Pages registrada na seção Publicação. A publicação inicial ainda está pendente de autenticação e autorização para criar o repositório público. Não há backend, chaves ou banco.
2. Abra a URL HTTPS no Chrome para Android. Para AR espacial, o aparelho precisa suportar ARCore e ter Google Play Services para AR instalado e atualizado. Autorize a câmera quando solicitada.
3. Teste primeiro o Estúdio, depois a Câmera e finalmente AR espacial. Para instalar o PWA, use a opção Instalar/Adicionar à tela inicial no Chrome, quando disponível.

Acesso via IP local por HTTP (por exemplo, http://192.168.x.x:8080) pode abrir a interface, mas não atende aos requisitos de segurança para câmera e WebXR. Use HTTPS com certificado confiável. O servidor Node incluído é para desenvolvimento local, não é uma hospedagem HTTPS.

## Arquitetura

- `index.html`, `style.css`: UI responsiva mobile-first.
- `src/app.js`: gerenciamento dos modos, WebXR, câmera, controles, captura, PWA.
- `src/engine.js`: WebGL 1, shaders, malhas procedurais, animações e iluminação direcional simples.
- `src/math.js`: matrizes de transformação, projeção e utilitários.
- `manifest.webmanifest`, `sw.js`, `icons/`: instalação PWA e cache offline dos arquivos após primeiro acesso.
- `server.mjs`: servidor HTTP local, sem dependências.
- `tests/`: testes unitários, testes de lógica com mocks e suíte de navegador Playwright.

A câmera, renderização e gravação são processadas localmente. O app não envia imagens, não solicita microfone e não usa analytics. Os arquivos capturados são baixados pelo navegador. O cache do PWA guarda apenas arquivos estáticos do app.

## Testes

`npm test`: 10 testes, incluindo os oito originais e verificações de manifest, referências em subdiretório, cache offline e descarte de caches antigos. `npm run check` valida a sintaxe dos arquivos JavaScript da aplicação e do servidor local.

Suíte de navegador: instale Python 3.12+, Playwright (`python -m pip install playwright==1.63.0`) e Chromium (`python -m playwright install chromium`). Execute `python tests/browser_test.py`. Ajuste a variável `CHROMIUM` com o caminho de um Chrome/Chromium instalado, se necessário. O teste usa câmera simulada e hospeda somente os arquivos públicos em um diretório temporário sob `/ar-play/`, com porta livre. `PREVIEW` permite salvar capturas; `BASE_URL` permite verificar a URL HTTPS publicada em vez do servidor temporário. Essas ferramentas são exclusivas de teste; o aplicativo continua sem dependências de execução. O WebXR real não é coberto por essa suíte.

Resultados da ARP-001, limitações do ambiente e estado da publicação: consulte [reports/report.md](reports/report.md). Câmera física, sensores, instalação no Android e ARCore exigem validação no aparelho.

## Publicação

Workflow: [deploy-pages.yml](.github/workflows/deploy-pages.yml), baseado no [mecanismo oficial do GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

**URL pública:** ainda indisponível. Endereço previsto, sujeito à criação autorizada do repositório: `https://jvt13.github.io/ar-play/`. Esse endereço não representa uma publicação concluída.

1. Autentique o GitHub CLI com `gh auth login --hostname github.com --git-protocol https --web --scopes workflow`. Não coloque credenciais no projeto.
2. Após autorização expressa para tornar o código público, crie um repositório novo `ar-play` na conta desejada. Se o nome já existir, interrompa e escolha um destino autorizado; não sobrescreva o repositório existente. Vincule esse destino ao remote `origin`.
3. Em **Settings → Pages → Build and deployment → Source**, selecione **GitHub Actions**.
4. Envie a branch `main` com `git push -u origin main`. Também é possível executar manualmente **Actions → Deploy GitHub Pages → Run workflow**, selecionando `main`.
5. Aguarde os testes e o deploy terminarem com sucesso; confirme HTTP 200 na URL e nos recursos. Registre a URL efetiva neste README e em `reports/report.md`.

O workflow exige aprovação dos testes Node, sintaxe e navegador antes de enviar o artefato ao Pages. Copia apenas `index.html`, `style.css`, `manifest.webmanifest`, `sw.js`, `src/` e `icons/` para um diretório temporário do runner. Servidor local, testes, relatórios, configurações e metadados do repositório não integram o site. A permissão de escrita no Pages e o token de identidade ficam limitados ao job de deploy.

Para atualizações futuras, altere a versão em `package.json` e o identificador `CACHE` em `sw.js`, registre o changelog, execute os testes e envie para `main`. O novo worker pré-carrega os arquivos, remove caches `ar-play-` antigos e assume o controle. Recarregue abas já abertas após a atualização para executar os módulos da nova versão. Preserve caminhos relativos, `start_url` e `scope` como `./`.

## Checklist de aceitação no celular

- Estúdio: abrir, verificar os três modelos, movimento, tamanho, rotação, dança e salto; sem tela preta.
- Câmera: permitir, trocar frontal/traseira; salvar PNG e vídeo e reproduzir os arquivos; confirmar encerramento da câmera ao sair do modo.
- AR espacial: tocar no modo, mover devagar o celular apontado para chão/mesa com textura e luz; verificar círculo de posicionamento, tocar e observar o personagem de ângulos diferentes. Testar joystick, escala, reposicionamento e saída da sessão. Evite caminhar olhando exclusivamente para a tela.
- Instalação: adicionar à tela inicial; depois do primeiro acesso, testar abrir o Estúdio offline.
- Desempenho: verificar fluidez, aquecimento, consumo de bateria e estabilidade em sessão de 5 minutos.

## Limitações e evolução

Esta é uma primeira versão funcional implementada em código, não uma versão homologada. Sem máscaras faciais, reconhecimento corporal, oclusão real, colisões, multiplayer, áudio ou biblioteca de modelos externos. A qualidade visual é simplificada. Não há APK. Se o requisito central for gravar a AR espacial com áudio, o próximo passo recomendado é avaliar aplicativo nativo Kotlin + ARCore com composição explícita da imagem da câmera e do render 3D; isso deve ser validado no hardware antes de escolher o pipeline definitivo.

Referências: https://developers.google.com/ar/develop/webxr/requirements ; https://developers.google.com/ar/develop/webxr/arcore-comparison ; https://developers.google.com/ar/devices ; https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream ; https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder .
