# AR Play — v1.2.0-alpha.1

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
- `src/build.js`, `src/boot.js`, `src/pwa.js`: identidade carregada, bootstrap coerente e atualização segura.
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

`npm test`: 470 testes registrados (462 aprovados e 8 expectativas físicas históricas aposentadas com justificativa), incluindo reconstrução 3D, projeções assimétricas, chão, confirmação/expiração, cobertura desconhecida, paredes/móveis, posições efetivas, recuo, deslizamento, escala e limpeza. A correção 1.1.1 acrescenta bloqueio imediato com mapa parcial, persistência lateral, liberação confiável, limites geométricos do contato e saída de sobreposição. A expiração de ocupação descarta votos livres fracos anteriores e retorna a desconhecido. O cache atual é `ar-play-v1.2.0-alpha.1-r1`. `npm run check` valida a sintaxe JavaScript. Geometria e sessões automatizadas são sintéticas; a suíte de navegador também verifica a integração XR simulada, a sonda com diagnóstico fechado e a preservação dos modos existentes.

Benchmark CPU opcional: `node tests/spatial_benchmark.mjs`. Usa geometria sintética, informa ambiente, mediana, p95 e máximos; não mede sensor, câmera ou desempenho no celular.

Suíte de navegador: instale Python 3.12+, Playwright (`python -m pip install playwright==1.63.0`) e Chromium (`python -m playwright install chromium`). Execute `python tests/browser_test.py`. Ajuste a variável `CHROMIUM` com o caminho de um Chrome/Chromium instalado, se necessário. O teste usa câmera simulada e hospeda somente os arquivos públicos em um diretório temporário sob `/ar-play/`, com porta livre. `PREVIEW` permite salvar capturas; `BASE_URL` permite verificar a URL HTTPS publicada em vez do servidor temporário. Essas ferramentas são exclusivas de teste; o aplicativo continua sem dependências de execução. O WebXR real não é coberto por essa suíte.

Câmera física, sensores, instalação no Android e ARCore exigem validação no aparelho. Os testes de navegador usam câmera simulada e não homologam WebXR/ARCore.

## Superfícies de apoio — 1.2.0-alpha.1 (ARP-005A)

Prévia de **percepção espacial passiva**. A física horizontal é a 1.1.9 homologada (`33bb98ed78dfc3c48885ea8b6298f6a84568cf1a`), preservada no histórico. Não há subida/descida, gravidade, aterrissagem, salto novo, oclusão ou mudança dos personagens. Superfícies elevadas não alteram a altura nem o movimento. A revisão é `arp005a-20261127-r1`, com versão/runtime/diagnóstico/cache provenientes de `src/build.js`.

`support-surfaces.js` recebe cópias numéricas dos pontos já reconstruídos, incluindo chão e alturas descartadas como ocupação. `support-view.js` os entrega **depois da decisão física**, sem importar o controlador ou consultar superfícies para mover o personagem. Não há nova aquisição de profundidade, varredura global adicional ou alteração do mapa de colisões. Atualmente a fonte depende da reconstrução existente: ative colisões no AR e observe a região. Sem amostras, a camada aguarda; não ativa colisões automaticamente nem marca o ambiente como livre.

O ajuste local exige pelo menos seis amostras distribuídas em dois eixos, normal e resíduos consistentes. Usa até 32 vizinhos em 36 cm para estimar o plano, mas só representa área onde triângulos medidos com arestas de até 18 cm sustentam sub-regiões inteiras. A máscara de 3 cm representa **cobertura observada**, não resolução/precisão nova do sensor ou do mapa de colisões. Pontos esparsos podem indicar uma superfície elevada candidata com área zero; três observações de pontos não inventam uma área. Vistas por baixo/rasantes, paredes, faces laterais e evidência curva/ambígua não confirmam um apoio superior.

Há até 128 regiões em múltiplas alturas, com normal, altura XR/relativa, inclinação, cobertura, estado, evidências independentes e idade. Regiões conectadas são agrupadas somente quando máscaras observadas se tocam e os planos são compatíveis. Limites de amostragem continuam desconhecidos. Uma possível borda próxima exige três alturas laterais atuais distintas; tem incerteza de 4,5 cm e conexão à cobertura ainda não comprovada. Não se produz um contorno físico completo para quedas.

Candidatas expiram após 5 s sem observação; regiões confirmadas permanecem por até 45 s e ficam históricas após 1,5 s. Revalidação usa quatro observações independentes de raios válidos que atravessam a região, envelope local cobrindo cada sub-região e veto para objeto presente ou oclusão. Ausência de profundidade e cobertura baixa não apagam apoios. Geração/referência/sessão incompatíveis limpam todos os dados e recursos; nada é persistido no navegador.

A interface interna inclui `query({x,z,radius,time,includeCandidates,below,above})`, `below(x,z,height,radius,time)`, `above(...)` e `boundaries({x,z,radius,time})`. Posições/alturas são em metros XR, tempo em milissegundos, inclinação em graus. Discos de raio até 0,5 m retornam até 32 componentes (com `moreAvailable` quando limitados), alturas candidatas, normal, limites observados, área, cobertura conhecida/desconhecida e revalidação. A cobertura verifica todas as sub-regiões tocadas pelo disco, inclusive bordas; um centro observado não basta. Limites retangulares são envelopes, não preenchimento de lacunas. `fullyObserved` significa somente cobertura geométrica conhecida, **não caminhabilidade ou resistência física**. Candidatas pontuais só aparecem com `includeCandidates`, com cobertura/área zero. Nenhuma dessas consultas está ligada à física nesta versão.

Em **Diagnóstico AR → Visualizar superfícies de apoio**, verde indica referência, ciano outro plano confirmado, amarelo candidato/incerto e roxo histórico em revalidação. A opção inicia desligada, é independente da geometria 3D e usa buffer GPU próprio; exibe até 512 pequenos preenchimentos/3072 vértices, com pontos amarelos para candidatas sem área. Alturas relativas e estados das principais superfícies aparecem no painel, sem rótulos flutuantes. Copiar/exportar/recuperar preservam um registro local anônimo de até 32 kB, com no máximo oito resumos de superfícies e geração/idade próprias; sem imagens, mapa bruto, normal/posição absoluta ou persistência entre sessões.

O orçamento cooperativo é de 2 ms por processamento, até 432 pontos/64 sementes/32 vizinhos, cadência própria de 250–1000 ms condicionada às aquisições existentes. Trabalho excedente é adiado; revalidação recebe prioridade alternada. Buffers fixos: 90128 bytes na camada e 73728 bytes na visualização, mais 128 registros e metadados; GPU opcional de 73728 bytes. Não é um limite rígido de tempo de CPU: um passo, GC ou agendamento pode ultrapassá-lo. Benchmark reproduzível: `node tests/support_benchmark.mjs <snapshot-1.1.9>`; `BENCH_REVERSE=1` inverte a ordem. Mede CPU desktop, não aquisição nativa ou FPS Android.

As 39 sequências da referência, com 400 atualizações cada, são comparadas integralmente em percepção ativa, visual e indisponível. Todos os estados físicos e contagens de mapa/sonda/rejeição/liberação permanecem iguais. A suíte também cobre os modos, fotos/vídeos, AR, múltiplas alturas, incerteza, memória/remoção, buffers independentes e migrações PWA desde 1.1.5 até 1.1.9. Os oito testes históricos desativados permanecem documentados e isolados.

**Homologação física da camada alfa pendente.** Saia do AR e atualize explicitamente a PWA; confirme `1.2.0-alpha.1`, revisão e cache na Ajuda. Posicione em chão livre, ative colisões, observe chão/caixa/assento/mesa por vários ângulos e ligue a visualização de apoios. Regiões sem dados devem continuar vazias; amarelo não significa área confirmada. Retire/desloque um objeto, observe novamente e compare a memória; oclusão não deve apagar apoio. Teste as duas visualizações separadas/juntas e confira movimento, giro, recuo e altura preservados. Exporte o JSON antes de recarregar se houver problema. Esta tarefa não inicia a ARP-005B.

## Mapeamento espacial — 1.1.9 (ARP-004J, referência estável)

A referência funcional é a 1.1.8, parcialmente homologada no aparelho. A candidata mantém os 12 cilindros circulares, o resolvedor, personagens, margens de 2,5/1,5 cm, voxels de 12 cm e memória consolidada de até 45 s. Estúdio e Câmera permanecem iguais, com a identificação compartilhada `v1.1.9`, revisão `arp004j-20261126-r1` e cache `ar-play-v1.1.9-r1`.

A classificação adicional de chão exige conexão com o apoio selecionado, sementes próximas, extensão em dois eixos, maioria de pontos compatíveis e três aquisições independentes. Usa os pontos já reconstruídos, com 8624 bytes fixos reutilizados. Um piso inclinado conectado ao apoio que alcança +9 cm deixou de produzir bloqueios falsos na fixture: Bip 81%, 400 atualizações, deslocamento 1,0544 → 1,88 m e rejeições 166 → 0. Não basta encontrar uma superfície horizontal elevada. Um plano uniforme +9 cm sem evidência junto ao apoio continua incerto e conservadoramente bloqueante: esses dados também poderiam representar um objeto baixo.

Para objetos finos, até 12 leituras locais extras por reconstrução procuram vizinhos de um retorno realmente medido acima do chão. Três pixels distintos próximos e as confirmações temporais existentes continuam obrigatórios. A grade global, a frequência e os buffers de 432 pontos não aumentam. Auxiliares fixos: mais 140 bytes. Bola, chinelo, brinquedo, pés e degrau são testados nos três personagens e em 40%, 81% e 100%, inclusive acima do piso corrigido. Um único pixel ruidoso não confirma obstáculo.

O chão corrigido só libera ocupações anteriores quando há evidências atuais compatíveis e os votos/hold originais. Objetos ocultos, dados ausentes e cobertura baixa conservam proteção. A fixture da cama combina vista parcial, outro ângulo, retorno, 10 s fora da vista, objeto ainda presente e remoção: as células consolidadas persistem e as observações válidas liberam o objeto retirado antes da expiração. Vistas rasantes podem não fornecer dados suficientes; observar por outro ângulo continua necessário.

O diagnóstico local recuperável separa a classificação/idade da última aquisição, a sobreposição no início do movimento, o contato na posição final e a última subconsulta rejeitada. Inclui confiança do apoio, diferença reconstruída, contagens de chão/obstáculo/incerto, origem/altura/idade das células e cobertura na direção pretendida. A geometria diagnóstica permanece desligada por padrão e possui legenda.

Um ensaio de estreitamento de contato diagonal foi rejeitado por prejudicar o deslizamento. As margens e a geometria estável da 1.1.8 permanecem. O círculo que contém animações pode parar antes do corpo em repouso; o relatório de contato decompõe essa diferença e a contribuição da representação medida. Não se promete distância física garantida nem melhoria de FPS Android.

As 39 sequências históricas preservam exatamente as 400 posições, rejeições e liberações da referência. O golden completo original permanece em `tests/fixtures/chain-v115.json`; o golden adicional `chain-v118-motion.json` foi extraído da 1.1.8, conferido contra os hashes anteriores e exclui somente contagens internas da representação espacial. Os oito testes históricos experimentais continuam isolados e justificados. Comparação/benchmark reproduzíveis: extraia `src/` da 1.1.8 em um diretório com `package.json` de ES Modules e execute `node tests/mapping-compare.mjs <snapshot>` e `node tests/mapping_benchmark.mjs <snapshot>`.

A PWA mantém ativação explícita, sem recarregar sessão AR ativa. Migrações reais de workers/caches 1.1.5, 1.1.6, 1.1.7 e 1.1.8 são testadas, incluindo a revisão seguinte aguardando durante XR e execução offline. **A 1.1.9 foi homologada no dispositivo nos cenários informados: posicionamento, movimentação, móveis, objetos pequenos e memória dinâmica. A homologação da nova camada alfa está pendente.** Após sair do AR, use Atualizar aplicativo, confirme versão/revisão/cache na Ajuda, posicione Bip 81% em chão livre e observe o piso e os obstáculos por dois ângulos. Teste avanço, giro, recuo, lateral, diagonal, objetos pequenos e retirada de objeto. Repita 40%/100%, reposicione e alterne colisões. Se houver bloqueio ou contato excessivo, exporte o JSON antes de recarregar e registre o obstáculo, tamanho e ângulo da câmera; não use regiões desconhecidas como prova de espaço livre.

## Recuperação da cadeia física — 1.1.8 (ARP-004I, histórico)

A cadeia física volta à referência funcional `14e6ca2` da 1.1.5. Mapa espacial, projeção/classificação, sonda, revalidação e volume circular de 12 faixas usam as implementações da referência. O resolvedor usa os mesmos passos, projeções de eixo e regras de saída, com captura adicional somente de escalares diagnósticos. Foram retirados o avanço parcial posterior e consultas automáticas extras de posicionamento. Margens de 2,5/1,5 cm, chão de 6 cm, voxels de 12 cm, memória de 45 s e sonda de 900 ms permanecem.

O controlador orientado foi retirado, inclusive o opt-in. Sua matemática histórica está isolada em `tests/experimental/`; o desenvolvimento continua no histórico Git. Oito testes específicos dos comportamentos físicos aposentados mantêm corpos e motivos de isolamento explícitos. Os demais testes anteriores aplicáveis continuam ativos. A revalidação volta ao critério legado de evidência livre, inclusive quando a pegada está parcialmente fora da vista; oclusão por superfície mais próxima, dados ausentes e evidência temporal continuam protegidos conforme a 1.1.5.

A comparação completa usa o controlador executado pela aplicação em 39 sequências (13 cenários, escalas 40%, 81% e 100%, 400 atualizações por sequência), incluindo aquisição, chão, ocupações, sonda e movimento. Todos os estados são comparados à execução da 1.1.5. As mesmas entradas também rodam na 1.1.7. A origem dos valores está em `tests/fixtures/chain-v115.json`; `tests/chain-compare.mjs` permite reproduzir a comparação com snapshots locais dos commits.

Sobreposição não é corrigida apagando obstáculos, concedendo imunidade ou deslocando o personagem sem entrada. Um piso informado coerentemente 9 cm acima do apoio gera ocupação e bloqueio nas três versões, incluindo a referência. Ruído pequeno e chão inclinado coerente com o apoio não produzem esse bloqueio nos testes. Essa limitação ilustra uma hipótese de erro de medição/referência; não identifica a causa no aparelho nem permite tratar os indicadores fornecidos como uma única consulta. O diagnóstico informa que a sobreposição normal foi medida no início do deslocamento (`placementMeasurement=move-start`).

Arquivo JSON anônimo e recuperável, eventos de sessão, limpeza visual e informações adicionais foram preservados sem condicionar o movimento. Os testes incluem repetição do recuo no controlador real: 12 ensaios por suíte de navegador, em três escalas, com deslocamento solicitado/permitido após 16 atualizações. A observação anterior de 200 ms continua registrada; o teste de progresso aguarda atualizações efetivas, sem tratar velocidade do navegador desktop como propriedade física.

## Versão carregada e atualização da PWA

`src/build.js` é a fonte de versão, revisão e cache usada pelo runtime, diagnóstico e Service Worker. A versão aparece permanentemente sob a marca em Estúdio, Câmera e AR. Ajuda, diagnóstico e JSON mostram o build carregado, revisão, cache, estado do SW e atualização identificada.

O bootstrap impede combinar módulos novos com o cache de uma versão antiga. Uma atualização aguardando ativação oferece **Atualizar**; o botão fica bloqueado enquanto AR ou gravação estiverem ativos. Encerre essas atividades e escolha a atualização. Somente essa ação explícita recarrega a página após a troca do controlador. Uma ativação externa por outra aba não recarrega automaticamente a sessão atual. Migrações a partir dos workers/caches 1.1.5, 1.1.6 e 1.1.7 são verificadas no navegador, além de continuidade de outra aba, revisão seguinte aguardando em XR e recarga offline.

Para comparar versões, extraia `src/` de `14e6ca2` e `8b7391d` em `reports/v115` e `reports/v117`, cada diretório com `package.json` contendo `{"type":"module"}`. Execute `node tests/chain-compare.mjs reports/v115 reports/v117` e `node tests/stability_benchmark.mjs reports/v115 reports/v117`. O benchmark mede mediana/p95/máximo de sete operações em CPU desktop; não mede FPS Android.

**Homologação física da 1.1.8 pendente.** Confirme a versão e a revisão na Ajuda, comece com Bip 81%, posicione em chão livre, mapeie e teste avanço, giro, recuo, deslizamento e mudança de direção. Repita em 40% e 100%, após reposicionar, mudar tamanho e ativar colisões depois de andar sem elas. Retire um objeto e observe a região por várias atualizações. Se houver trava, exporte o JSON antes de recarregar e registre o apoio, a escala e o movimento tentado. A restauração e as simulações não certificam sensores nem resolvem automaticamente ocupações produzidas por erro de medição.

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
