# PFR

Sistema para gerar o plano de fogo realizado em Excel a partir de arquivos operacionais da frente PP.

## Fluxo
1. Descobre os arquivos de entrada.
2. Valida estrutura e colunas.
3. Cria backup dos insumos.
4. Resolve ID do plano e data/hora do disparo.
5. Consolida os dados e aplica as regras de negócio, incluindo preenchimento determinístico de `tempo detonacao (ms)` vazio, negativo, inválido ou repetido pela posição do furo na sequência `Number`, garantindo tempos inteiros e únicos; também faz o fechamento opcional da carga total aplicada ao alvo configurado preservando os extremos da coluna e, em modo de teste, aplica variação controlada de `tampao realizado` com exportação de `tampao previsto` / `tampao realizado` em uma casa decimal.
6. Exporta o Excel final com rastreabilidade.

## Entradas
- `input/*PROJETO COMPLETO*.csv|xlsx`
- `input/*CONFIG FINAL*.csv|xlsx`
- `input/PP.pdf`
- `input/HISTO-*.txt`

## Saídas
- `output/Plano_Fogo_Realizado_<PLANO>.xlsx`
- `backup/<timestamp>/...`
- `logs/geracao_<data>.log`

## Execução local
```bash
python main.py --config config.yaml
# interface web local
python main.py --web --host 127.0.0.1 --port 5000
```

## Operação online

O projeto pode ser usado de duas formas:

- `public/` é a aplicação publicada no GitHub Pages: `https://silvathiagoferreira.github.io/pfr-openblast/`.
- A página usa processamento local no navegador por padrão. CSV/XLSX, HISTO e as regras determinísticas são executados no próprio computador e o Excel é gerado para download. Não há inteligência artificial, chave de API ou serviço pago.
- A biblioteca de Excel usada no navegador é distribuída localmente em `public/vendor/`, sem dependência de CDN durante a operação.
- `src/pfr/web.py` continua disponível para instalações que desejem hospedar o backend Flask separadamente. Esse backend não é necessário para a página pública.

O arquivo `public/config.js` mantém `window.PFR_API_BASE` vazio para impedir que a página publicada dependa de um endpoint externo. Os anexos não são enviados para servidor no modo público.

### Proteções da interface online

- Limite de 250 MB por requisição e até 20 arquivos por execução.
- Arquivos com nomes repetidos são recusados para evitar sobrescrita silenciosa.
- As tabelas são identificadas pelas colunas obrigatórias, portanto o usuário pode renomear os arquivos sem quebrar a operação.
- O HISTO é identificado pelo nome ou pela presença de eventos `[Fire]`; o PDF é validado pelo cabeçalho `%PDF-` antes do processamento.
- Execuções temporárias com mais de 24 horas são removidas automaticamente.
- Falhas de identificação do plano ou do evento `[Fire]` interrompem a execução; o sistema não usa a data/hora atual como substituição.
- `business.plan_id_source: fallback` sempre respeita `business.fallback_plan_id`, evitando que IDs encontrados no PDF substituam o plano operacional configurado.
- Quando uma frente usa `plan_id_source: fallback` mas o HISTO não grava o ID no bloco `[BlastingPlan]`, `business.allow_unmatched_plan_fire_fallback: true` permite usar o último `[Fire]` existente; esse comportamento é explícito e reprodutível a partir do próprio HISTO.
- Em caso de falha, a interface gera um log local da validação no navegador para download em `.txt`.

## Regra de plano e horario
Para evitar capturar ID de detonador como se fosse plano, configure `business.fallback_plan_id` com o plano operacional quando necessario. O ID e interpretado como `PLANO;MÊS;ANO`: o sistema associa o bloco do HISTO pelo mesmo plano e ano, ignorando o mês, porque o plano pode ser emitido em um mês e detonado em outro. A data/hora do disparo e extraida pelo primeiro `[Fire]` posterior ao bloco `[BlastingPlan]` correspondente. Zeros à esquerda e separadores não alteram a identidade; o ID do evento no HISTO é usado na saída. Se houver mais de um bloco compatível, o mês coincidente é usado como desempate; persistindo múltiplos candidatos, a execução é interrompida com erro de ambiguidade.

Exemplo validado:
- Plano: `320526`
- Marcador no historico: `PP320526`
- Disparo: `[Fire]2026/05/13-12:01:43`

## Regra de carga total
Quando `business.enforce_charge_total_target` estiver habilitado, o total de `cargas realizadas` e fechado em `business.charge_total_target_kg` sem alterar o furo de menor carga nem o de maior carga.

No site, o campo opcional **Forçar total de carga realizada** permite informar esse alvo diretamente em kg para a execução atual. O valor é distribuído entre os furos intermediários, mantendo o menor e o maior valor originais e fechando o total com precisão. Sem habilitar o campo, o site preserva a distribuição padrão; se o alvo for inviável, a validação é interrompida com o motivo.

## Estrutura
- `input/` — coloque os arquivos de entrada aqui
- `output/` — Excel gerado aqui
- `backup/` — backup automático dos insumos
- `src/` contém a lógica modular.
- `tests/` contém testes de fumaça e validação básica.

## Anexos no modo online
Os arquivos podem ser adicionados em várias seleções ou arrastados em momentos diferentes. A lista mantém os anexos já carregados, permite remover cada item individualmente e só então iniciar a validação. A identificação do plano usa também os IDs encontrados nas tabelas e no nome dos arquivos, comparando plano e ano com o HISTO após normalizar zeros à esquerda e separadores comuns, sem bloquear por mês diferente.
