# Changelog

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
