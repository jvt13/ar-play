# AR Play — v1.1.7 (MVP)

Aplicativo web de personagens 3D interativos, inspirado na experiência de câmera com efeitos de realidade aumentada. Não é uma reprodução do TikTok. Os três personagens (Bip, Nori e Luma) são construídos proceduralmente, sem baixar modelos ou usar ativos proprietários.

## Modos

- **Estúdio 3D**: demonstração sem câmera. Funciona em navegador com WebGL.
- **Câmera criativa**: câmera frontal/traseira + personagens 3D compostos em um canvas, foto PNG e vídeo WebM/MP4 conforme os codecs disponíveis. Não rastreia superfícies físicas. Vídeo sem áudio.
- **AR espacial**: usa WebXR `immersive-ar`, `hit-test` e `dom-overlay` sobre ARCore. Detecta superfícies horizontais e posiciona um personagem em coordenadas do mundo durante a sessão. O personagem pode ser movido em um plano horizontal, com colisões reais experimentais opcionais, sem oclusão. Foto e vídeo são desabilitados neste modo. A gravação de tela do próprio Android é uma alternativa a testar, não um recurso do aplicativo.

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
- `src/spatial-map.js`: reconstrução no referencial XR e mapa esparso temporário de ocupação/cobertura.
- `src/collision.js`: volumes dos personagens, consultas locais, resolução horizontal e diagnóstico das colisões.
- `src/movement-probe.js`: sonda do corredor de movimento, evidência imediata e memória curta de contatos derivados da profundidade.
- `src/engine.js`: WebGL 1, shaders, malhas procedurais, animações e iluminação direcional simples.
- `src/math.js`: matrizes de transformação, projeção e utilitários.
- `manifest.webmanifest`, `sw.js`, `icons/`: instalação PWA e cache offline dos arquivos após primeiro acesso.
- `server.mjs`: servidor HTTP local, sem dependências.
- `tests/`: testes unitários, testes de lógica com mocks e suíte de navegador Playwright.

A câmera, renderização e gravação são processadas localmente. O app não envia imagens, não solicita microfone e não usa analytics. Os arquivos capturados são baixados pelo navegador. O cache do PWA guarda apenas arquivos estáticos do app.

## Testes

`npm test`: 196 testes, incluindo reconstrução 3D, projeções assimétricas, chão, confirmação/expiração, cobertura desconhecida, paredes/móveis, posições efetivas, recuo, deslizamento, escala e limpeza. A correção 1.1.1 acrescenta bloqueio imediato com mapa parcial, persistência lateral, liberação confiável, limites geométricos do contato e saída de sobreposição. A expiração de ocupação descarta votos livres fracos anteriores e retorna a desconhecido. O cache atual é `ar-play-v1.1.7`. `npm run check` valida a sintaxe JavaScript. Geometria e sessões automatizadas são sintéticas; a suíte de navegador também verifica a integração XR simulada, a sonda com diagnóstico fechado e a preservação dos modos existentes.

Benchmark CPU opcional: `node tests/spatial_benchmark.mjs`. Usa geometria sintética, informa ambiente, mediana, p95 e máximos; não mede sensor, câmera ou desempenho no celular.

Suíte de navegador: instale Python 3.12+, Playwright (`python -m pip install playwright==1.63.0`) e Chromium (`python -m playwright install chromium`). Execute `python tests/browser_test.py`. Ajuste a variável `CHROMIUM` com o caminho de um Chrome/Chromium instalado, se necessário. O teste usa câmera simulada e hospeda somente os arquivos públicos em um diretório temporário sob `/ar-play/`, com porta livre. `PREVIEW` permite salvar capturas; `BASE_URL` permite verificar a URL HTTPS publicada em vez do servidor temporário. Essas ferramentas são exclusivas de teste; o aplicativo continua sem dependências de execução. O WebXR real não é coberto por essa suíte.

Câmera física, sensores, instalação no Android e ARCore exigem validação no aparelho. Os testes de navegador usam câmera simulada e não homologam WebXR/ARCore.

## Recuperação da jogabilidade — 1.1.7 (ARP-004H)

O padrão volta aos 12 cilindros circulares da 1.1.5, conservadores para todas as orientações e animações. Giro e dança adotam a orientação do controle sem consulta espacial de pose: o volume circular é invariável. Translação, recuo e deslizamento continuam passando pelo mesmo resolvedor e pelas mesmas proteções de contato. Margem de 2,5 cm, pele de 1,5 cm, voxels de 12 cm, retenção de 45 s e sonda de 900 ms permanecem.

O volume orientado da 1.1.6 fica experimental, desativado na aplicação e acessível somente por `new ARCollisions({}, {orientedVolume:true})` em desenvolvimento/testes. Há um único resolvedor e campo de colisões por controlador. Os testes orientados em `tests/oriented.test.js` e os ensaios de rejeição de pose continuam explícitos. O perfil circular pode parar antes do corpo em repouso e precisa de corredores mais largos; a estabilidade tem prioridade nesta versão. A visualização azul mostra as faixas circulares efetivamente usadas.

A comparação dirigida usou 14e6ca2 (1.1.5) e d7ac837 (1.1.6), as mesmas geometrias e sequências em 40%, 54%, 66%, 81% e 100%. A 1.1.6 rejeitou giros próximos a ocupações e durante sobreposição; os ensaios não reproduziram um bloqueio geral de translação. Sem JSON da regressão física, a causa completa permanece não confirmada. A candidata circular reproduz as 40 combinações de referência de deslocamento e contato da 1.1.5, sem novas penetrações nos cenários controlados. A origem dos valores está em `tests/fixtures/recovery-v115.json`.

Em um corredor diagonal, quando os dois eixos separados estão bloqueados mas parte do vetor original está livre, o resolvedor permite essa parte até contato. O diagnóstico distingue a fonte/etapa da última subconsulta rejeitada do contato representativo na posição final: penetrações desses contatos diferentes não devem ser subtraídas. O raio geral é o envelope de busca; o apoio direcional do contato é registrado separadamente.

Posicionamento adota imediatamente a altura do hit-test. Novas evidências podem indicar **Posição sobreposta: afaste-se ou reposicione**, sem teletransporte ou imunidade. Reposicionar limpa o mapa dependente do apoio; uma nova sessão começa vazia. Contato/mensagem antigos são limpos imediatamente ao mudar a geração. O diagnóstico recuperável inclui até 16 eventos de início, posicionamento, suspensão/retomada e limpeza, identificados por sessão/geração, sem coordenadas absolutas. Alterações de personagem/escala podem criar sobreposição: afaste-se ou reposicione. São preservados avanço parcial válido, reconstrução otimizada, memória adaptativa e mapeamento guiado. Não há física vertical nem mudanças nos personagens, Estúdio ou Câmera.

Células bloqueantes continuam priorizadas para revalidação. O texto informa visibilidade da pegada, amostras coerentes/distintas e idade da última consulta. Pegada parcialmente fora da vista não é liberada por observar apenas o centro. Observe centro e bordas da região antiga por várias atualizações; dados insuficientes/oclusão preservam ocupação válida. Isso não certifica a precisão física nem identifica automaticamente obstáculos fantasmas.

O diagnóstico informa perfil físico, orientação pretendida/adotada, motivo e contagem de rejeições de pose/translação, deslocamento solicitado/permitido e sobreposição inicial. Os dados vêm do controlador real; continuam limitados, anônimos, em memória JS, com exportação JSON e recuperação após o fim da sessão.

Homologação física da **1.1.7 pendente**. Comece com Bip a **81%**, faça mapeamento guiado e percorra uma área conhecida: avance, recue após contato, deslize na parede, gire parado e inverta rapidamente o joystick. Retire um objeto e observe toda a região por várias atualizações. Repita em 40%, 54%, 66% e 100% e teste suspensão/retomada e nova sessão. Após bloqueio suspeito, solte o joystick e exporte o diagnóstico antes de recarregar.

Benchmarks CPU sintéticos: `node --expose-gc tests/spatial_benchmark.mjs`, `node --expose-gc tests/memory_benchmark.mjs` e `node tests/volume_benchmark.mjs`. Para comparação histórica, extraia `src/` dos commits 14e6ca2 e d7ac837 para `reports/v115` e `reports/v116`, respectivamente, cada um com `package.json` contendo `{"type":"module"}`. Execute `node tests/recovery_compare.mjs reports/v115 reports/v116` e `node tests/recovery_benchmark.mjs reports/v115 reports/v116`. Não medem FPS Android nem certificam comportamento físico.

## Contato e recuperação do diagnóstico — 1.1.5

Margem do mapa (2,5 cm), pele (1,5 cm), perfis dos 12 cilindros e escala visual foram preservados. O acabamento numérico do contato remove a folga extra de um subpasso; em paredes sintéticas ideais, volume e superfície ficam separados pelas margens de 4 cm. Superfícies locais alinhadas aos eixos, contínuas e estáveis podem usar limites normais recentes de três atualizações coerentes, evitando que um extremo antigo aumente indefinidamente a espessura física. Demais casos mantêm a geometria conservadora existente. A grade de 12 cm continua sendo índice espacial.

O envelope inclui animações e orientações, portanto pode parar antes do corpo em repouso. Fixtures de parede vertical mostraram folgas visuais analíticas de aproximadamente 7,8 a 20,3 cm conforme personagem/escala, mesmo com 4 cm entre volume e parede. Isso é uma limitação geométrica demonstrada, não medição/calibração do aparelho. Não há garantia física de 2–5 cm nem mudança arbitrária dos modelos/volumes.

Revalidação prioriza células que bloquearam e voltaram à vista. Além do critério legado de 18 cm, cinco raios podem comprovar travessia completa do envelope medido com as margens existentes e incerteza numérica de profundidade. Mudanças menores podem liberar antes dos 45 s quando toda a pegada é observável e livre; uma parte ainda presente, oclusão ou dados insuficientes preservam ocupação. Sequências de raios legados e consultas dirigidas são independentes e nunca somadas para fabricar confirmações. Branco na geometria 3D destaca até oito células responsáveis pelo último bloqueio e um contato calculado, respeitando validade e limites visuais.

O mapa mantém todos os endpoints ocupados (até 432). Raios livres redundantes ficam limitados a 96 por atualização, com até 32 próximos priorizados e restante distribuído/rotativo. Cobertura livre pode levar mais atualizações; desconhecido não se torna prova de espaço livre. O diagnóstico separa aquisição, grade, reconstrução, atualização/consolidação, refinamento de contato, raios, revalidação e manutenção. Recuperação adaptativa aceita custo abaixo de 3,2 ms com 16 atualizações; preserva recuperação rápida abaixo de 2 ms e redução acima de 4 ms. Valores são custos medidos no ambiente, não garantia Android.

Depois de encerrar AR, **Último diagnóstico AR** permite recuperar o último registro textual nesta mesma página. Contém versão, sessão, geração do mapa, eventos relativos, último bloqueio, contato e até oito identificadores de células com idade/estado/evidência livre/motivo, além do motivo de limpeza/fim. Esses identificadores não codificam coordenadas. É limitado a um registro de até 32 kB, até 32 eventos e oito motivos; não contém coordenadas absolutas, poses completas, imagens, mapas ou profundidade bruta. **Copiar** informa sucesso/falha; **Exportar diagnóstico** salva JSON localmente, inclusive se a área de transferência falhar. **Limpar histórico** remove o texto. O painel ativo também oferece exportação/limpeza; limpar texto não apaga o mapa ativo. Não há transmissão nem armazenamento automático persistente. Recarregar/fechar a página perde esse registro: exporte antes, se necessário.

Visibilidade temporariamente oculta/desfocada suspende processamento e entrada, mantendo memória na mesma sessão/referência. TTL continua decorrendo. Retorno exige referência sem reset e pose válida; pose inválida enquanto visível, reset e fim limpam a geometria. Outra sessão começa vazia e é identificada separadamente. Reposicionamento continua limpando devido à dependência do apoio/origem; não há reaproveitamento inseguro de coordenadas.

Homologação física da 1.1.5 pendente: comparar contato em 40%, 54%, 66% e 100%, mapear/retirar/deslocar uma caixa segura, reobservar centro e bordas, testar objeto oculto, recuo/deslizamento e suspensão/retorno. Após falha, soltar joystick, sair de AR e copiar/exportar o registro antes de recarregar. Não interpretar sobreposição visual como penetração comprovada, pois não há oclusão real.

## Memória espacial experimental — 1.1.4

Colisões continuam opcionais e desligadas inicialmente. A memória vive somente na sessão AR: candidatas duram 1 s, confirmadas recentes 5 s e consolidadas até 45 s após a última observação válida, mesmo fora da vista. Consolidação exige 8 atualizações independentes, pelo menos 1,5 s e consistência geométrica. Pontuações/votos não são precisão certificada. Sem reobservação, a ocupação vence e retorna a desconhecido; desconhecido não comprova espaço livre e não é bloqueado indiscriminadamente.

Quando a câmera retorna, consultas dirigidas ao centro medido verificam ocupações conhecidas. Leituras coerentes no mesmo local renovam a retenção. Profundidade válida além da superfície, em quatro atualizações distintas e pelo menos 300 ms, pode remover ocupação antes dos 45 s. Uma superfície mais próxima indica oclusão e preserva a memória anterior; dado ausente, isolado ou rasante não comprova remoção. O objeto deslocado é mapeado na nova posição e a antiga é liberada independentemente, sem reconhecimento semântico. A confirmação depende de visibilidade, resolução e dados utilizáveis; não há liberação instantânea garantida.

Para observar o ambiente antes de caminhar, ative Colisões reais, abra Diagnóstico AR e toque em **Mapear ambiente**. Mova lentamente a câmera: o personagem fica parado, enquanto novas células candidatas e consistência são adquiridas. **Concluir mapeamento** libera os controles sem apagar o mapa. É opcional; o mapa também atualiza no uso normal. Não há percentual de cômodo completo.

Na geometria 3D: vermelho indica confirmação recente; violeta, consolidação; rosa, ocupação aguardando revalidação; verde-claro, centros liberados por evidência livre recente. Demais cores e projeção permanecem as da 1.1.3. Visualização desativada inicialmente, com até 64 caixas, 32 centros liberados e 6000 vértices. Nem toda a memória cabe na visualização. Ocupações antigas continuam bloqueando enquanto válidas. Texto copiado inclui contagens, idades, revalidações/liberações, expiração, oclusão, saturação, custos, modo guiado e origem temporal do último bloqueio.

Limites mantidos: 4096 células ocupadas/candidatas, 8192 livres; aquisição de novas regiões até 3 m do personagem. Revalidação examina até 256 posições locais e 96 entradas rotativas, escolhe até 8 alvos e consulta até 40 amostras por atualização. O orçamento reduz e recupera conforme custo; uma memória grande pode levar várias atualizações para ser revalidada por inteiro. Saturação prioriza ocupações consolidadas próximas e pode recusar novas entradas quando não existe candidato adequado a descarte. Manutenção é parcelada; células vencidas deixam de colidir imediatamente, ainda que a remoção da entrada esteja pendente.

Desativar colisões, reposicionar, perder a validade do rastreamento/reference space ou encerrar AR limpa tudo. Não há salvamento em servidor, arquivos, IndexedDB ou outra sessão. O aplicativo não transmite a geometria. `node --expose-gc tests/memory_benchmark.mjs` mede operações sintéticas e heap aproximado em desktop; não mede precisão ou FPS Android.

Homologação física da 1.1.4 pendente. Para validar: observar um móvel por alguns segundos, virar a câmera por mais de 5 s e retornar; verificar bloqueio conhecido. Retirar uma caixa segura e voltar a observá-la: a antiga região deve liberar após evidência suficiente. Repetir com objeto deslocado e com uma superfície mais próxima ocultando a anterior; oclusão não deve apagar a memória. Comparar com colisões desligadas, três personagens, 63%/100%, recuo/deslizamento e copiar diagnóstico após qualquer bloqueio incorreto. Sobreposição visual sem oclusão não comprova penetração física.

## Diagnóstico AR experimental — 1.0.2

A baseline 1.0.1 recebeu 18/18 aprovações físicas na ARP-002, conforme informado pelo gestor. A disponibilidade de profundidade CPU da 1.0.2 foi confirmada pelo usuário; a precisão geométrica ainda não foi validada por medidas de referência. O teste físico da 1.1.0 identificou instabilidade nas colisões; a correção 1.1.1 exige nova homologação física.

Entre em **AR espacial** e toque em **Diagnóstico AR**. O painel começa desligado em cada sessão e pode ser fechado sem sair de AR. Estúdio e Câmera mantêm seus controles e aparência. O painel mostra WebXR, sessão, acesso e formato concedidos, resolução real do mapa, profundidade central em metros, amostras válidas da vista e FPS XR estimado.

- **Não suportado:** a API CPU não está exposta pelo navegador.
- **Não concedido:** a sessão iniciou sem profundidade; isso não confirma falta de suporte do aparelho.
- **Aguardando dados:** recurso concedido, mas sem mapa, rastreamento ou amostras válidas no momento.
- **Dados disponíveis:** há amostras utilizáveis.
- **Falha de leitura:** erro ou dados incompatíveis; a renderização AR continua e novas leituras podem recuperar o diagnóstico.

O recurso `depth-sensing` é opcional, com acesso `cpu-optimized` e preferência por `luminance-alpha`/`float32`. Se uma implementação rejeitar a extensão por incompatibilidade, há uma tentativa com a configuração AR original. Falhas de permissão não são repetidas. Nenhuma API nativa Android é chamada e nenhum acesso GPU é solicitado.

**Mapa de profundidade** é uma opção adicional: uma grade de 32×24 amostras da vista, com perto em claro, 5 m ou mais em escuro e pixels inválidos em preto. O limite de 5 m é apenas a escala visual. Sem mapa, a grade é 8×8. O percentual se refere às amostras consultadas, não a toda a imagem nem à confiança/precisão do sensor. A resolução exibida é a do buffer recebido. O centro mede profundidade em relação ao plano da câmera, não distância radial ou altura sobre o chão.

As leituras, a transformação de coordenadas e a conversão para metros acontecem dentro do callback XR; buffers nativos não são mantidos entre frames. O diagnóstico atualiza no máximo a 4 Hz, com redução para 1 Hz em leituras acima de 8 ms. Com colisões habilitadas, a aquisição é compartilhada com o mapa espacial, sem segunda consulta nativa no mesmo frame. Desligar o diagnóstico não desliga as colisões; desligar ambos interrompe as leituras JavaScript. O custo nativo do recurso negociado pode persistir até o fim da sessão. Não há logs contínuos, gravação ou envio desses dados.

Para validar no celular: recarregue online após a atualização, abra AR com o diagnóstico desligado e confirme o funcionamento anterior. Ative o painel, registre aparelho/Chrome, estados, acesso, formato, resolução, centro, amostras, FPS e tempo de leitura. Aponte para uma parede aproximadamente perpendicular à câmera e compare o centro com distâncias de referência. Teste movimento lento, interrupção temporária do rastreamento, mapa ligado/desligado, fechamento do painel e nova sessão. Não interprete ausência de dados como medição zero. Repita os controles e capturas da baseline.

Gravidade adicional, subida em objetos e oclusão não estão implementadas. A baseline 1.0.2 permanece no histórico em `53fa32899a48b840553f6078c0185c8b667b08ad`; uma restauração deve usar um novo commit de reversão e o fluxo normal de publicação, sem force push.

Referências: [WebXR versus ARCore](https://developers.google.com/ar/develop/webxr/arcore-comparison), [Depth do ARCore](https://developers.google.com/ar/develop/depth) e [WebXR Depth Sensing](https://www.w3.org/TR/webxr-depth-sensing-1/). A disponibilidade é confirmada pelas capacidades da sessão no navegador, sem presumir equivalência com as APIs nativas.

## Colisões reais — experimental (1.1.1)

Entre em AR espacial, posicione o personagem na superfície de apoio e marque **Colisões reais (experimental)**. A opção começa desligada em cada sessão. O mapa funciona com o diagnóstico fechado. Desativar limpa o mapa e libera a movimentação convencional, interrompendo o trabalho exclusivo das colisões.

O personagem interrompe o avanço contra ocupação confirmada ou evidência imediata coerente, pode recuar e deslizar lateralmente. O pulo continua visual: seu volume horizontal permanece ancorado ao apoio e não permite atravessar uma parede conhecida. Não há deslocamento automático para fora de obstáculos. Em sobreposição inicial, movimentos que aliviam o contato ou são tangenciais continuam possíveis, além da busca limitada de uma saída próxima. Casos profundos podem exigir reposicionamento manual.

Estados: **Mapeando ambiente**, **Colisões ativas**, **Obstáculo detectado**, **Cobertura limitada** e **Profundidade indisponível**. A decisão combina mapa persistente e uma sonda do corredor pretendido. Cobertura limitada não ignora evidência frontal recente nem ocupação válida. Sem qualquer evidência utilizável, mantém-se a movimentação convencional com indicação de limitação; regiões desconhecidas não são consideradas comprovadamente livres. Não há garantia de bloqueio em áreas sem observação ou após expiração de toda evidência.

| Parâmetro inicial | Valor |
| --- | --- |
| Voxel / região de interesse | 12 cm / raio de 3 m ao redor do personagem |
| Confirmação | Três atualizações distintas; múltiplos pixels no mesmo frame não bastam |
| Validade da ocupação | Até 5 s sem nova observação; depois volta a desconhecido |
| Remoção antecipada | Pelo menos 750 ms desde a última observação e quatro atualizações consecutivas com raio livre a até 3,5 cm do centro observado, terminando além da margem de 18 cm |
| Atualização espacial | Alvo inicial 8 Hz, adaptativo conforme custo |
| Sonda imediata | Até 75 consultas em corredor de largura coerente com o personagem e alcance adicional de 85 cm; até aproximadamente 15 Hz durante movimento, reduzido a 8 Hz se o custo superar 2 ms |
| Evidência imediata | Pelo menos três pixels nativos distintos e próximos, unidos em segmentos locais de até 26 cm; memória geométrica de 900 ms e limite de 128 segmentos |
| Limites de memória | 4.096 células de ocupação/candidatas e 8.192 de cobertura livre amostrada |
| Tolerância do apoio | 6 cm, metade do voxel, configurável para avaliação de ruído |

O filtro usa a normal e a altura do apoio escolhido. Outras superfícies horizontais acima dele não são automaticamente transitáveis. Pontos acima do personagem são excluídos da faixa de colisão. Cilindros conservadores acompanham escala e dimensões derivadas dos modelos, incluindo caminhada/dança; em escala AR padrão, os raios são aproximadamente 32 cm para Bip/Luma e 37 cm para Nori. Esses volumes foram preservados. A consulta refina cada voxel com os limites efetivamente observados, margem de 2,5 cm e pele de 1,5 cm, evitando acrescentar toda a espessura do voxel à parede. A resolução continua aproximada.

A reconstrução usa profundidade axial, projeção inversa e pose da vista do mesmo XRFrame. A transformação vista/mapa é aplicada uma vez. Metadados de sensor incompatíveis são rejeitados; na API CPU legada, utiliza-se o contrato de alinhamento à vista solicitado na sessão. Não são misturadas coordenadas CSS, pixels de tela e metros XR.

O mapa usa até 432 amostras por atualização, rejeita pontos isolados e reduz para 192 amostras sob carga. A taxa diminui quando a reconstrução ultrapassa o orçamento de 4 ms e pode se recuperar gradualmente após estabilização. A sonda projeta posições do corredor na vista real do mesmo frame, reutiliza a aquisição CPU e conta pixels distintos, sem consultar novamente `getDepthInformation`. Apenas evidência coerente adquirida no frame pode reforçar o mapa, respeitando suas confirmações temporais. Contatos em memória não renovam sua própria validade. O corredor usa a intenção do frame anterior: pode haver até um frame de atraso no início ou troca de direção. Esses orçamentos não são resultados medidos no aparelho. As duas camadas só armazenam dados derivados em memória e são limpas ao desativar, encerrar, reposicionar ou invalidar o referencial. Reset do reference space exige novo posicionamento.

No **Diagnóstico AR**, consulte pontos usados, células ocupadas, frequência, reconstrução, custo da sonda, consulta final, cobertura, direção bloqueada, origem do bloqueio (mapa, sonda ou ambos), idade da confirmação do bloqueio e FPS. O apoio local conta vizinhos coerentes; não mede precisão nem confiança do sensor. Cobertura insuficiente é indicada separadamente da ausência de bloqueio atual. A opção **Obstáculos e volume** mostra uma vista superior XR: vermelho para ocupação confirmada do mapa e círculo verde para o personagem; os contatos exclusivos da sonda não aparecem nessa imagem. O fundo escuro não comprova espaço livre; a visualização é limitada a 512 células e começa desligada.

Limitações: mapa esparso e temporário, confirmação com atraso e precisão ainda não calibrada. Objetos finos, pequenos, fora da vista ou sob a tolerância podem não ser detectados. A resolução e o cilindro conservador podem bloquear passagens visualmente apertadas; superfícies removidas podem permanecer por até 5 s se não houver observações livres confiáveis. A sonda pode manter contato por até 900 ms após retirada do objeto. O aumento de persistência reduz esquecimentos, com esse custo de liberação mais lenta. Não se trata de reconstrução completa, reconhecimento de objetos ou confirmação de que uma região desconhecida está livre.

Para validar: recarregue online a versão 1.1.1 e compare desligado/ligado. Teste primeiro chão livre e reposicionamento, depois parede e móvel baixos: avanço, recuo, diagonal, lateral e pulo. Mude levemente a câmera mantendo o obstáculo visível e confira a continuidade do bloqueio. Repita com diagnóstico fechado e aberto, cobertura limitada, os três personagens e escalas. Remova um obstáculo e confira liberação por observação confiável ou expiração em até 5 s. Compare objetos acima do personagem, perda de rastreamento e encerramento. Registre origem do bloqueio, apoio local, idade, cobertura, FPS, custos e medidas físicas de referência. Refaça as funcionalidades da baseline. A baseline 1.1.0 permanece no histórico em `e01205801ce0b8e0ac00044e019d53bb88c0df67`; qualquer restauração usa novo commit, sem force push.

## Refinamento experimental 1.1.2

O volume usa 12 cilindros por faixa de altura, derivados das esferas originais em caminhada/dança com margem conservadora. O raio máximo anterior permanece na consulta ampla; o contato usa o raio da faixa atingida. A redução de distância depende da altura do obstáculo e do personagem: faixas largas continuam conservadoras. Os testes com 63% e 100% verificam contenção e posições efetivas. Os modelos e o pulo visual foram preservados.

A sonda mantém o alcance validado e o limite de 75 consultas, incluindo as bordas laterais e uma amostragem mais baixa. A intenção é calculada antes da aquisição no mesmo frame; uma mudança superior a 60° antecipa a próxima sondagem sem apagar contatos válidos. A memória temporal não aumentou. A recuperação adaptativa exige oito atualizações consecutivas abaixo de 2 ms por passo, mantendo a proteção de carga e os limites anteriores.

O diagnóstico distingue repouso, espera de aquisição, fora de vista, profundidade inválida, rejeição geométrica e evidência insuficiente. Contadores mostram projeções, repetições de pixels e rejeições. Até 32 eventos ficam somente em memória e preservam o último movimento após soltar o joystick: intenção, deslocamento efetivo, origem do bloqueio, cobertura, escala, dimensões, custos e FPS do frame. Desativar colisões, reposicionar, perder o referencial ou encerrar limpa o registro.

**Copiar diagnóstico textual** copia esse resumo para a área de transferência mediante toque. Não inclui imagens, mapas completos ou dados brutos. O aplicativo não transmite nem persiste o registro; o texto copiado permanece sob controle do usuário. O painel continua rolável e os avisos de posicionamento ficam separados das opções de AR.

Para homologar, compare paredes e colchões nas escalas 63%/100% com os três personagens. Copie o diagnóstico logo após uma travessia ou bloqueio inesperado, compare repouso e movimento, mudanças rápidas de direção e recuperação de frequência. A precisão e o desempenho no Android ainda exigem validação física da 1.1.2.

## Validação geométrica e depuração 1.1.3

Foram corrigidos casos sintéticos em que a redução do maior contato ocultava o agravamento de outro contato, no mapa ou na sonda. Cada contato relevante é verificado antes do deslocamento; uma saída de sobreposição exige destino livre e não pode introduzir um contato antes ausente. A tangência local usa a direção medida dos pontos quando disponível. Margens, perfis corporais e persistência foram preservados. Isso não homologa os relatos físicos da 1.1.2.

O joystick continua relativo à câmera. A transformação horizontal agora é compartilhada entre intenção e movimento efetivo. A orientação visual do personagem não inverte a consulta. A profundidade continua axial, no referencial local XR; metadados via `depth.view`, quando existentes, também são verificados. Na API CPU legada sem esses metadados, preserva-se o contrato de alinhamento à vista. Falta de suporte continua permitindo o modo AR original.

Em **Diagnóstico AR**, ative **Visualizar geometria 3D** após posicionar o personagem e ligar colisões. A opção começa desligada e pode continuar visível com o painel fechado. Verde: amostras compatíveis com o apoio; amarelo: candidatos reconstruídos; cinza: reconstruídos fora da faixa/ROI; vermelho: limites ocupados confirmados; laranja: contatos recentes da sonda; azul: as 12 faixas do volume, incluindo pele de contato; grade discreta: plano de apoio escolhido; magenta/ciano: deslocamento solicitado/permitido, sem amplificação. A grade não é reconstrução adicional do chão. A ausência de pontos não indica espaço livre. Os contornos azuis usam 24 segmentos por círculo.

O desenho usa os mesmos shaders, referencial e projeção do personagem. Limites: 6.000 vértices, os até 432 pontos já reconstruídos, 64 células e 128 contatos. O buffer CPU ocupa 144.000 bytes; o buffer WebGL do mesmo tamanho é liberado ao desligar. Nenhuma imagem ou mapa completo é copiado pelo diagnóstico textual.

O texto preserva um **último bloqueio** separado dos 32 eventos, mesmo após soltar o joystick ou fazer movimentos livres. Registra entrada do controle, vetor XR, direção/instante da última sonda, posições anterior/pretendida/final, deslocamentos, penetrações, motivo, contato disponível, idade da evidência, apoio, escala, aquisição e custos. Valores indisponíveis ficam explícitos. Desativar colisões, reposicionar, perder o rastreamento/referencial ou encerrar limpa os dados.

Também são mostrados apoio lógico, base renderizada, sombra, pulo e altura do plano na posição atual. Pés em repouso coincidem com o apoio nas fixtures; caminhada/pulo podem produzir deslocamentos visuais. O movimento permanece horizontal: num apoio inclinado, a diferença para o plano pode variar, sem ajuste automático de altura. Não há subida, gravidade adicional ou oclusão real; sobreposição na imagem não prova penetração física.

Para homologar a 1.1.3, compare câmera parada e em movimento, quatro direções e diagonais. Observe se pontos e linhas permanecem no ambiente ao mover o celular. Após bloqueio invertido ou travessia, solte o joystick e copie o diagnóstico textual, incluindo o último bloqueio. Compare 63%/100%, os três personagens, chão, parede e colchão. Precisão, alinhamento e desempenho no Android ainda dependem desse teste.

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

As validações físicas anteriores não homologam as colisões experimentais da 1.1.1. Sem máscaras faciais, reconhecimento corporal, oclusão real, subida em objetos, multiplayer, áudio ou biblioteca de modelos externos. A qualidade visual é simplificada. Não há APK. Se o requisito central for gravar a AR espacial com áudio, o próximo passo recomendado é avaliar aplicativo nativo Kotlin + ARCore com composição explícita da imagem da câmera e do render 3D; isso deve ser validado no hardware antes de escolher o pipeline definitivo.

Referências: https://developers.google.com/ar/develop/webxr/requirements ; https://developers.google.com/ar/develop/webxr/arcore-comparison ; https://developers.google.com/ar/devices ; https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream ; https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder .

Os vetores de movimento usam as posições lógicas registradas, sem deslocamento gráfico de altura. São anotações desenhadas sobre as malhas virtuais para continuarem visíveis, usando a mesma projeção; não alteram o contato nem representam oclusão física.
