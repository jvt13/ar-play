# Changelog

## 1.1.4 — 2026-11-25

- Memória de ocupação adaptativa por sessão: candidatas, confirmadas, consolidadas e aguardando revalidação; retenção consolidada de 45 s e expiração para desconhecido.
- Revalidação dirigida limitada, compartilhando aquisição CPU existente, com evidência temporal para superfícies removidas/deslocadas e preservação diante de oclusão/dados inválidos.
- Limpeza dos contatos derivados da sonda correspondentes a células liberadas; colisão individual, recuo, deslizamento e proteção contra cruzamento preservados.
- Manutenção parcelada, descarte controlado em saturação e limites de 4096 ocupadas/candidatas e 8192 livres mantidos.
- Mapeamento guiado opcional sem perda do mapa ao concluir; cores 3D e diagnóstico de memória, idade, origem temporal e custos.
- Fixtures temporais completas, testes e benchmark de memória; cache ar-play-v1.1.4 com src/revalidation.js. Sem dependências de execução; homologação física pendente.

## 1.1.3 — 2026-11-25

- Auditoria matemática direcionada com fixtures independentes de profundidade axial, UV, projeção assimétrica, rotação/inclinação, controle, pés e apoio fora de Y=0.
- Correção de agravamento de contatos oculto pelo máximo entre fontes/células; verificação por contato e saída próxima condicionada a destino livre e ausência de contatos novos.
- Transformação horizontal compartilhada entre intenção e deslocamento, mantendo a semântica relativa à câmera.
- Validação de metadados `depth.view` quando disponíveis, preservando o caminho legado CPU.
- Vetores do diagnóstico nas posições registradas, sem deslocamento artificial de altura; anotações visíveis sobre as malhas virtuais.
- Visualização 3D opcional com dados existentes do algoritmo, mesmo pipeline WebGL do personagem, limites fixos, volume, apoio e vetores reais.
- Diagnóstico detalhado e resumo independente do último bloqueio; base renderizada medida no desenho original, sem ajuste automático de altura.
- Cache `ar-play-v1.1.3-r2` e inventários atualizados com `src/spatial-debug.js`. Sem novas dependências de execução ou homologação física antecipada.

## 1.1.2 — 2026-11-25

- Volume composto por 12 faixas de altura conservadoras derivadas dos modelos, preservando escala e envelope máximo.
- Sonda com bordas laterais, faixa baixa e intenção do mesmo frame; nova sondagem ao inverter direção.
- Recuperação adaptativa após oito aquisições rápidas por passo, com proteção de carga preservada.
- Diagnóstico de inatividade, aquisição e rejeições; histórico limitado de 32 movimentos e cópia textual manual.
- Ajuste de fluxo AR para separar posicionamento, opção de colisões e estado, mantendo painel rolável.
- Fixtures de contato, colchão, visibilidade, inversão de direção, recuperação e limpeza. Cache ar-play-v1.1.2 com módulo volume.
- Sem homologação física antecipada, novas dependências ou alteração dos modelos.


## 1.1.1 — 2026-11-25

- Correção experimental das colisões AR com combinação de mapa persistente e sonda imediata do corredor de movimento, ativa mesmo com diagnóstico fechado.
- Sonda limitada a 75 consultas e 128 segmentos derivados; requer pixels distintos e suporte espacial coerente, com memória de contato de 900 ms. Aquisição nativa compartilhada no mesmo XRFrame.
- Ocupação mantida por até 5 s, removida antecipadamente apenas após 750 ms sem observação e quatro confirmações livres centrais consecutivas; raios rasantes continuam sendo evidência fraca.
- Refinamento dos voxels com limites observados e margem de 2,5 cm, preservando cilindros dos personagens e pele de contato de 1,5 cm.
- Resolução de sobreposição permite recuo e movimento tangencial sem aumentar a penetração; mantém subpassos e saída próxima, sem deslocamento automático.
- Diagnóstico mostra origem do bloqueio, amostras/apoio local da sonda, custo, idade da confirmação e cobertura insuficiente. Apoio local não representa precisão do sensor.
- Fixtures geométricas e sessões XR simuladas cobrem mapa parcial, persistência lateral, liberação confiável, recuo, deslizamento, fallback e limpeza; benchmark mede separadamente sonda, mapa e consulta final.
- Expiração de ocupação descarta votos livres fracos acumulados, retornando a região a desconhecida; regressão geométrica cobre esse caso limite.
- Cache final `ar-play-v1.1.1-r2` e inventários públicos atualizados; a revisão substitui também o primeiro deploy da correção. Baseline 1.1.0 preservada no histórico; sem dependências de execução, alterações de modelos ou homologação física antecipada.

## 1.1.0 — 2026-11-25

- Colisões reais experimentais no modo AR, desligadas por padrão e independentes do painel de diagnóstico.
- Reconstrução de profundidade axial no referencial XR, com projeção inversa, pose do mesmo frame e rejeição de geometria de fonte incompatível.
- Mapa esparso temporário de 12 cm, limitado em memória, com confirmação temporal, descarte de ruído, cobertura desconhecida, raios de espaço observado e expiração.
- Cilindros derivados dos modelos, seguindo seleção e escala; bloqueio horizontal, recuo, deslizamento, subpassos e saída de sobreposição inicial sem deslocamento automático.
- Pulo visual preservado sem deslocar o volume horizontal; sem gravidade adicional, subida ou oclusão.
- Aquisição CPU compartilhada com o diagnóstico, sem duplicar consultas no mesmo XRFrame.
- Indicadores de mapa/colisão, visualização superior opcional e limites adaptativos de frequência e amostras.
- Limpeza ao desativar, encerrar, reposicionar ou invalidar o referencial; baseline 1.0.2 preservada no histórico.
- Testes geométricos sintéticos, integração XR simulada e benchmark CPU reproduzível; sem homologação física antecipada.
- Cache `ar-play-v1.1.0` com os novos módulos e inventários públicos atualizados. Sem dependências de execução.

## 1.0.2 — 2026-11-24

- Depth Sensing opcional na sessão WebXR, com preferência CPU e fallback para a configuração AR anterior.
- Novo módulo `src/depth.js` para leitura no XRFrame, transformação vista/mapa, conversão para metros e descarte de dados inválidos.
- Opção **Diagnóstico AR**, desligada por padrão, com estados de capacidade, resolução, profundidade central, amostragem válida, FPS e custo de leitura.
- Mapa opcional reduzido de profundidade, amostragem limitada a 4 Hz e redução para 1 Hz em leituras acima de 8 ms.
- Encerramento limpa referências de sessão e buffers de visualização; nenhuma transmissão ou persistência dos dados do ambiente.
- Cache offline `ar-play-v1.0.2`, incluindo o novo módulo, e inventários públicos atualizados.
- Testes de profundidade simulados e integração XR simulada no navegador, preservando os testes existentes.
- Motor, modelos, animações e modos Estúdio/Câmera preservados. Sem novas dependências de execução, colisões, gravidade ou oclusão.
- Baseline 1.0.1 homologada na ARP-002 com 18/18 testes, conforme informação do gestor. Profundidade experimental ainda pendente de validação física.

## 1.0.1 — 2026-11-24

- Preparação da publicação no GitHub Pages via GitHub Actions, com execução automática em `main` e disparo manual.
- Testes Node, sintaxe JavaScript e navegador como condições obrigatórias para publicação.
- Artefato gerado em diretório temporário, contendo exclusivamente os arquivos públicos da aplicação.
- Cache do Service Worker atualizado para `ar-play-v1.0.1`; preservada a limpeza de versões anteriores.
- Validação do manifest, ícones, referências relativas, escopo do worker, funcionamento offline e hospedagem em `/ar-play/`.
- Suíte de navegador existente adaptada para staging temporário, verificação HTTP/MIME, exclusão de arquivos privados, console e URL externa opcional.
- README com instruções de publicação, atualização e testes no Android.
- Relatórios internos em `reports/` excluídos do versionamento e do histórico publicável.
- Arquitetura, motor WebGL, personagens, animações, layout e funcionalidades preservados. Nenhuma dependência de execução adicionada.

WebXR/ARCore não homologado em dispositivo físico.
