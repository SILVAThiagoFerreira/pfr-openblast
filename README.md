# PFR

Sistema para gerar o plano de fogo realizado em Excel a partir de arquivos operacionais da frente PP.

## Fluxo
1. Descobre os arquivos de entrada.
2. Valida estrutura e colunas.
3. Cria backup dos insumos.
4. Resolve ID do plano e data/hora do disparo.
5. Consolida os dados e aplica as regras de negócio, incluindo preenchimento determinístico de `tempo detonacao (ms)` vazio, fechamento opcional da carga total aplicada ao alvo configurado preservando os extremos da coluna e, em modo de teste, variação controlada de `tampao realizado` com exportação de `tampao previsto` / `tampao realizado` em uma casa decimal.
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

O projeto tem duas camadas publicadas a partir do mesmo repositório:

- `public/` é a interface estática publicada no GitHub Pages: `https://silvathiagoferreira.github.io/pfr-openblast/`.
- `src/pfr/web.py` é a API Flask que recebe os anexos, cria uma execução isolada, roda o pipeline auditável e devolve o `.xlsx`. O `render.yaml` e o `Dockerfile` permitem hospedá-la em `https://pfr-openblast.onrender.com`.

O arquivo `public/config.js` aponta a interface para a API pública. Para uma instalação em outro domínio, altere apenas `window.PFR_API_BASE`. O processamento nunca depende de arquivos do computador do usuário: os anexos são enviados para a execução temporária do backend e descartados quando há falha.

### Proteções da interface online

- Limite de 250 MB por requisição e até 20 arquivos por execução.
- Arquivos com nomes repetidos são recusados para evitar sobrescrita silenciosa.
- Execuções temporárias com mais de 24 horas são removidas automaticamente.
- Falhas de identificação do plano ou do evento `[Fire]` interrompem a execução; o sistema não usa a data/hora atual como substituição.
- `business.plan_id_source: fallback` sempre respeita `business.fallback_plan_id`, evitando que IDs encontrados no PDF substituam o plano operacional configurado.
- Quando uma frente usa `plan_id_source: fallback` mas o HISTO não grava o ID no bloco `[BlastingPlan]`, `business.allow_unmatched_plan_fire_fallback: true` permite usar o último `[Fire]` existente; esse comportamento é explícito e reprodutível a partir do próprio HISTO.
- Em caso de falha, o backend preserva o log técnico da execução para download em `.txt`; se a API estiver indisponível, a interface gera um log local de conexão no navegador.

## Regra de plano e horario
Para evitar capturar ID de detonador como se fosse plano, configure `business.fallback_plan_id` com o plano operacional quando necessario. A data/hora do disparo e extraida do `HISTO-*.txt` pelo primeiro `[Fire]` posterior ao bloco `[BlastingPlan]` que contem esse plano. Quando o PDF trouxer o plano com zero à esquerda e o `HISTO` registrar a mesma frente sem esse zero, o sistema trata as duas formas como equivalentes.

Exemplo validado:
- Plano: `320526`
- Marcador no historico: `PP320526`
- Disparo: `[Fire]2026/05/13-12:01:43`

## Regra de carga total
Quando `business.enforce_charge_total_target` estiver habilitado, o total de `cargas realizadas` e fechado em `business.charge_total_target_kg` sem alterar o furo de menor carga nem o de maior carga.

## Estrutura
- `input/` — coloque os arquivos de entrada aqui
- `output/` — Excel gerado aqui
- `backup/` — backup automático dos insumos
- `src/` contém a lógica modular.
- `tests/` contém testes de fumaça e validação básica.
