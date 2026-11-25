# AR Play — v1.0.2 (MVP)

Aplicativo web de personagens 3D interativos, inspirado na experiência de câmera com efeitos de realidade aumentada. Não é uma reprodução do TikTok. Os três personagens (Bip, Nori e Luma) são construídos proceduralmente, sem baixar modelos ou usar ativos proprietários.

## Modos

- **Estúdio 3D**: demonstração sem câmera. Funciona em navegador com WebGL.
- **Câmera criativa**: câmera frontal/traseira + personagens 3D compostos em um canvas, foto PNG e vídeo WebM/MP4 conforme os codecs disponíveis. Não rastreia superfícies físicas. Vídeo sem áudio.
- **AR espacial**: usa WebXR `immersive-ar`, `hit-test` e `dom-overlay` sobre ARCore. Detecta superfícies horizontais e posiciona um personagem em coordenadas do mundo durante a sessão. O personagem pode ser movido em um plano horizontal, sem colisão nem oclusão por objetos reais. Foto e vídeo são desabilitados neste modo. A gravação de tela do próprio Android é uma alternativa a testar, não um recurso do aplicativo.

## Executar no computador

Requisitos: Node.js 18+ e navegador com WebGL. Nenhuma dependência npm.

Na pasta ARPlay, execute `npm start`. Abra `http://localhost:8080` no navegador. Não precisa executar `npm install`. Para encerrar o servidor, Ctrl+C. A porta pode ser configurada pela variável de ambiente PORT.

## Executar no Android

1. Abra a URL HTTPS do GitHub Pages registrada na seção Publicação. Não há backend, chaves ou banco.
2. Abra a URL HTTPS no Chrome para Android. Para AR espacial, o aparelho precisa suportar ARCore e ter Google Play Services para AR instalado e atualizado. Autorize a câmera quando solicitada.
3. Teste primeiro o Estúdio, depois a Câmera e finalmente AR espacial. Para instalar o PWA, use a opção Instalar/Adicionar à tela inicial no Chrome, quando disponível.

Acesso via IP local por HTTP (por exemplo, http://192.168.x.x:8080) pode abrir a interface, mas não atende aos requisitos de segurança para câmera e WebXR. Use HTTPS com certificado confiável. O servidor Node incluído é para desenvolvimento local, não é uma hospedagem HTTPS.

## Arquitetura

- `index.html`, `style.css`: UI responsiva mobile-first.
- `src/app.js`: gerenciamento dos modos, WebXR, câmera, controles, captura, PWA.
- `src/depth.js`: negociação opcional de profundidade e diagnóstico experimental em AR, sem física ou oclusão.
- `src/engine.js`: WebGL 1, shaders, malhas procedurais, animações e iluminação direcional simples.
- `src/math.js`: matrizes de transformação, projeção e utilitários.
- `manifest.webmanifest`, `sw.js`, `icons/`: instalação PWA e cache offline dos arquivos após primeiro acesso.
- `server.mjs`: servidor HTTP local, sem dependências.
- `tests/`: testes unitários, testes de lógica com mocks e suíte de navegador Playwright.

A câmera, renderização e gravação são processadas localmente. O app não envia imagens, não solicita microfone e não usa analytics. Os arquivos capturados são baixados pelo navegador. O cache do PWA guarda apenas arquivos estáticos do app.

## Testes

`npm test`: 21 testes, incluindo os dez anteriores e testes direcionados de profundidade com dados e sessões simulados. Cobrem conversão, transformações, indisponibilidade, negociação/fallback, dados inválidos, diagnóstico, limite de leitura e limpeza. `npm run check` valida a sintaxe JavaScript, incluindo o módulo de profundidade.

Suíte de navegador: instale Python 3.12+, Playwright (`python -m pip install playwright==1.63.0`) e Chromium (`python -m playwright install chromium`). Execute `python tests/browser_test.py`. Ajuste a variável `CHROMIUM` com o caminho de um Chrome/Chromium instalado, se necessário. O teste usa câmera simulada e hospeda somente os arquivos públicos em um diretório temporário sob `/ar-play/`, com porta livre. `PREVIEW` permite salvar capturas; `BASE_URL` permite verificar a URL HTTPS publicada em vez do servidor temporário. Essas ferramentas são exclusivas de teste; o aplicativo continua sem dependências de execução. O WebXR real não é coberto por essa suíte.

Câmera física, sensores, instalação no Android e ARCore exigem validação no aparelho. Os testes de navegador usam câmera simulada e não homologam WebXR/ARCore.

## Diagnóstico AR experimental — 1.0.2

A baseline 1.0.1 recebeu 18/18 aprovações físicas na ARP-002, conforme informado pelo gestor. A profundidade da 1.0.2 ainda precisa de validação física própria.

Entre em **AR espacial** e toque em **Diagnóstico AR**. O painel começa desligado em cada sessão e pode ser fechado sem sair de AR. Estúdio e Câmera mantêm seus controles e aparência. O painel mostra WebXR, sessão, acesso e formato concedidos, resolução real do mapa, profundidade central em metros, amostras válidas da vista e FPS XR estimado.

- **Não suportado:** a API CPU não está exposta pelo navegador.
- **Não concedido:** a sessão iniciou sem profundidade; isso não confirma falta de suporte do aparelho.
- **Aguardando dados:** recurso concedido, mas sem mapa, rastreamento ou amostras válidas no momento.
- **Dados disponíveis:** há amostras utilizáveis.
- **Falha de leitura:** erro ou dados incompatíveis; a renderização AR continua e novas leituras podem recuperar o diagnóstico.

O recurso `depth-sensing` é opcional, com acesso `cpu-optimized` e preferência por `luminance-alpha`/`float32`. Se uma implementação rejeitar a extensão por incompatibilidade, há uma tentativa com a configuração AR original. Falhas de permissão não são repetidas. Nenhuma API nativa Android é chamada e nenhum acesso GPU é solicitado.

**Mapa de profundidade** é uma opção adicional: uma grade de 32×24 amostras da vista, com perto em claro, 5 m ou mais em escuro e pixels inválidos em preto. O limite de 5 m é apenas a escala visual. Sem mapa, a grade é 8×8. O percentual se refere às amostras consultadas, não a toda a imagem nem à confiança/precisão do sensor. A resolução exibida é a do buffer recebido. O centro mede profundidade em relação ao plano da câmera, não distância radial ou altura sobre o chão.

As leituras, a transformação de coordenadas e a conversão para metros acontecem dentro do callback XR; buffers nativos não são mantidos entre frames. Indicadores e mapa atualizam no máximo a 4 Hz. Uma leitura acima de 8 ms reduz essa frequência para 1 Hz, indicada no painel. Desligar o diagnóstico interrompe as leituras JavaScript; o custo nativo do recurso negociado pode persistir até o fim da sessão e deve ser avaliado no aparelho. Não há logs contínuos, gravação ou envio de dados de profundidade.

Para validar no celular: recarregue online após a atualização, abra AR com o diagnóstico desligado e confirme o funcionamento anterior. Ative o painel, registre aparelho/Chrome, estados, acesso, formato, resolução, centro, amostras, FPS e tempo de leitura. Aponte para uma parede aproximadamente perpendicular à câmera e compare o centro com distâncias de referência. Teste movimento lento, interrupção temporária do rastreamento, mapa ligado/desligado, fechamento do painel e nova sessão. Não interprete ausência de dados como medição zero. Repita os controles e capturas da baseline.

Colisões, gravidade, subida em objetos e oclusão não estão implementadas. A versão funcional 1.0.1 permanece no histórico em `5b68c7b86453cbe6858492f4d0bc5a594e9cc7f6`; uma restauração deve usar um novo commit de reversão e o fluxo normal de publicação, sem force push.

Referências: [WebXR versus ARCore](https://developers.google.com/ar/develop/webxr/arcore-comparison), [Depth do ARCore](https://developers.google.com/ar/develop/depth) e [WebXR Depth Sensing](https://www.w3.org/TR/webxr-depth-sensing-1/). A disponibilidade é confirmada pelas capacidades da sessão no navegador, sem presumir equivalência com as APIs nativas.

## Publicação

Workflow: [deploy-pages.yml](.github/workflows/deploy-pages.yml), baseado no [mecanismo oficial do GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

**URL pública:** [Abrir AR Play](https://jvt13.github.io/ar-play/).

**Repositório:** [jvt13/ar-play](https://github.com/jvt13/ar-play).

O GitHub Pages usa **GitHub Actions** como fonte de publicação. Cada push em `main` executa os testes e publica somente após sua aprovação. Para acompanhar o resultado ou executar manualmente, abra [Actions → Deploy GitHub Pages](https://github.com/jvt13/ar-play/actions/workflows/deploy-pages.yml) e selecione `main` em **Run workflow**. Aguarde o deploy terminar com sucesso e confirme a aplicação na URL acima.

O workflow exige aprovação dos testes Node, sintaxe e navegador antes de enviar o artefato ao Pages. Copia apenas `index.html`, `style.css`, `manifest.webmanifest`, `sw.js`, `src/` e `icons/` para um diretório temporário do runner. Servidor local, testes, relatórios, configurações e metadados do repositório não integram o site. A pasta `reports/` é exclusivamente local e está excluída do versionamento. A permissão de escrita no Pages e o token de identidade ficam limitados ao job de deploy.

Para futuras versões do aplicativo, altere a versão em `package.json` e o identificador `CACHE` em `sw.js`, registre o changelog e execute `npm test`, `npm run check` e `python tests/browser_test.py`. Faça commit dos arquivos públicos e de desenvolvimento necessários e envie com `git push origin main`. Relatórios em `reports/` devem permanecer exclusivamente locais. Aguarde o workflow e valide a URL publicada; para usar a suíte contra produção, defina `BASE_URL=https://jvt13.github.io/ar-play/` no ambiente antes de executar o teste de navegador. O novo worker pré-carrega os arquivos, remove caches `ar-play-` antigos e assume o controle. Recarregue abas já abertas após a atualização para executar os módulos da nova versão. Preserve caminhos relativos, `start_url` e `scope` como `./`.

## Checklist de aceitação no celular

- Estúdio: abrir, verificar os três modelos, movimento, tamanho, rotação, dança e salto; sem tela preta.
- Câmera: permitir, trocar frontal/traseira; salvar PNG e vídeo e reproduzir os arquivos; confirmar encerramento da câmera ao sair do modo.
- AR espacial: tocar no modo, mover devagar o celular apontado para chão/mesa com textura e luz; verificar círculo de posicionamento, tocar e observar o personagem de ângulos diferentes. Testar joystick, escala, reposicionamento e saída da sessão. Evite caminhar olhando exclusivamente para a tela.
- Instalação: adicionar à tela inicial; depois do primeiro acesso, testar abrir o Estúdio offline.
- Desempenho: verificar fluidez, aquecimento, consumo de bateria e estabilidade em sessão de 5 minutos.

## Limitações e evolução

A homologação física informada para a baseline 1.0.1 não homologa o diagnóstico experimental da 1.0.2. Sem máscaras faciais, reconhecimento corporal, oclusão real, colisões, multiplayer, áudio ou biblioteca de modelos externos. A qualidade visual é simplificada. Não há APK. Se o requisito central for gravar a AR espacial com áudio, o próximo passo recomendado é avaliar aplicativo nativo Kotlin + ARCore com composição explícita da imagem da câmera e do render 3D; isso deve ser validado no hardware antes de escolher o pipeline definitivo.

Referências: https://developers.google.com/ar/develop/webxr/requirements ; https://developers.google.com/ar/develop/webxr/arcore-comparison ; https://developers.google.com/ar/devices ; https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream ; https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder .
