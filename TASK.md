# TASK

Reestruturar o gerador de plano de fogo em uma base modular, configurável e validada, preservando a capacidade de processar o layout PP atual e produzir o Excel final com rastreabilidade.

Regras operacionais atuais:
- O plano operacional pode ser fixado em `business.fallback_plan_id` quando a extracao automatica puder capturar IDs de detonadores ou eventos de teste.
- Se o PDF e o HISTO representarem o mesmo plano com e sem zero à esquerda, o sistema deve tratar as duas formas como equivalentes para resolver o bloco correto e o nome da saida.
- A data/hora do disparo deve ser o primeiro `[Fire]` posterior ao `[BlastingPlan]` que contem o plano correto, nunca o ultimo `[Fire]` do arquivo inteiro.
- `DetonatingTime` vazio é preenchido por interpolação linear determinística na sequência ordenada por `Number`.
- `DetonatingTime` imputado é arredondado para inteiro, sem casas decimais.
- Valores originais de tampão não são alterados automaticamente; padrões repetitivos devem ser tratados como sinal de validação, não com randomização.
- Em modo de teste, `tampao realizado` pode receber variação determinística de até `0,12` para mais ou para menos e `tampao previsto` / `tampao realizado` devem ser exportados com uma casa decimal.
- Quando houver furos com `InputedCharge` zerado, a carga deve ser redistribuída com total alvo configurado, preservando o menor e o maior valor da coluna.
- Quando `business.enforce_charge_total_target` estiver habilitado, a carga total aplicada deve fechar no alvo configurado mesmo sem furos zerados, preservando o menor e o maior valor da coluna.
- A publicação no GitHub Pages deve operar sem inteligência artificial, chave de API ou serviço pago; o modo público processa os anexos localmente no navegador.
- A interface pública deve identificar as tabelas pelas colunas, validar a assinatura do PDF, rejeitar anexos duplicados/excessivos e gerar log local quando a validação falhar.

Critério objetivo de conclusão:
- o projeto possui documentação completa;
- a configuração centraliza caminhos e parâmetros;
- o fluxo executa por um único entrypoint;
- as etapas de leitura, validação, processamento e exportação estão separadas.

## Atualização do modo online
- Permitir inclusão e remoção incremental de anexos sem reiniciar a seleção.
- Reconhecer variações do ID do plano no HISTO, no nome do arquivo e nas tabelas, incluindo zeros à esquerda e separadores.
