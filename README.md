# Gerador de PGR para Condomínios

Versão 2, completa e compatível com GitHub Pages, do aplicativo PWA que configura e gera Programas de Gerenciamento de Riscos em Word (`.docx`), incluindo o relatório psicossocial da NR-01 a partir do CSV exportado do Google Forms.

## Publicação no GitHub Pages

1. Extraia este ZIP.
2. Crie um repositório vazio no GitHub.
3. Envie **todo o conteúdo desta pasta**, inclusive a pasta `.github`.
4. Use a branch `main`.
5. No repositório, abra **Settings → Pages**.
6. Em **Build and deployment**, escolha **GitHub Actions**.
7. Abra a aba **Actions** e acompanhe a rotina **Publicar no GitHub Pages**.

Após a conclusão, o endereço publicado aparecerá na própria execução e em **Settings → Pages**. Novos envios para a branch `main` serão publicados automaticamente.

## Executar no computador

É necessário ter Node.js 22 e pnpm 11.

```bash
pnpm install
pnpm dev
```

Para testar o mesmo pacote utilizado pelo GitHub Pages:

```bash
pnpm build
pnpm preview
```

## Recursos incluídos

- seleção dos condomínios do documento-base;
- configuração do quadro de funcionários por cargo e GHE;
- checklist de atividades, ambientes e exposições;
- inventário de riscos com matriz qualitativa 6 × 4;
- EPIs, treinamentos, inspeções e plano de ação;
- importação local do CSV de respostas da NR-01;
- vinculação automática por nome ou CNPJ do condomínio;
- indicadores por domínio, questões prioritárias e plano de ação psicossocial;
- proteção de resultados detalhados quando houver menos de três respostas;
- inclusão do relatório NR-01 como anexo no mesmo arquivo Word do PGR;
- salvamento automático no navegador;
- instalação como PWA e funcionamento básico offline;
- geração do documento final em Word diretamente no navegador.

## Nota técnica

O arquivo gerado é uma minuta estruturada. Cargos, ambientes, atividades, exposições, controles e enquadramentos legais devem ser confirmados em campo e validados pelo responsável técnico antes da emissão definitiva. O questionário fornecido é tratado como instrumento personalizado de consulta e triagem coletiva, não como aplicação integral do HSE Indicator Tool.
