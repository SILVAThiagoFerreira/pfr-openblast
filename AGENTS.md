# AGENTS.md

## Regras Permanentes
- Trate este projeto como um sistema auditável, não como um script isolado.
- Nunca concentre leitura, validação, processamento e exportação no mesmo módulo.
- Toda decisão operacional deve vir de `config.yaml` quando for parametrizável.
- Todo processamento deve ser precedido por validação explícita.
- Toda execução deve gerar log e backup dos insumos.
- Toda saída deve ser reprodutível e identificável pelo ID do plano.

## Restrições Técnicas
- Um único ponto de entrada: `main.py`.
- Código-fonte modular em `src/pfr/`.
- Não usar automação COM.
- Não depender de estado implícito global.
- Não esconder falhas de validação.

## Evolução
- Mudanças de regra devem atualizar `SPEC.md`, `PIPELINE.md` e `DATA_SCHEMA.md`.
- Mudanças de comportamento devem atualizar `README.md` e `TASK.md`.
- Testes mínimos devem ser mantidos em `tests/`.
