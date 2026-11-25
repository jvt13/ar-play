# Changelog

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
