import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it, vi } from 'vitest';
import { PoweradeMcpError } from '../modules/powerade/powerade.errors';
import { registrarHerramientasDelPowerade } from './powerade.tools';

/** Un servidor MCP real conectado a un cliente real por un canal en memoria. */
async function conectar(servicio: Record<string, ReturnType<typeof vi.fn>>) {
  const server = new McpServer({ name: 'prueba', version: '0' });
  registrarHerramientasDelPowerade(server, servicio as never, vi.fn());

  const [canalCliente, canalServidor] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'cliente', version: '0' });
  await Promise.all([server.connect(canalServidor), client.connect(canalCliente)]);
  return client;
}

const servicioFalso = () => ({
  iniciar: vi.fn().mockResolvedValue({ draftId: 'abc', torneo: { nombre: 'T' } }),
  material: vi.fn().mockReturnValue('[{"matchId":1}]'),
  publicar: vi.fn().mockResolvedValue({ tournamentId: 6, version: 1, accion: 'nueva' }),
});

describe('registrarHerramientasDelPowerade', () => {
  it('registra exactamente powerade_iniciar, powerade_material y powerade_publicar', async () => {
    const client = await conectar(servicioFalso());

    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name).sort()).toEqual([
      'powerade_iniciar',
      'powerade_material',
      'powerade_publicar',
    ]);
  });

  it('el inputSchema de cada una pesa menos de 16.384 bytes (claude.ai descarta en silencio las que pasan)', async () => {
    const client = await conectar(servicioFalso());

    const { tools } = await client.listTools();

    for (const tool of tools) {
      expect(JSON.stringify(tool.inputSchema).length).toBeLessThan(16_384);
    }
  });

  it('cada descripción dice cuándo llamarla', async () => {
    const client = await conectar(servicioFalso());

    const { tools } = await client.listTools();
    const descripcion = (nombre: string) => tools.find((t) => t.name === nombre)?.description ?? '';

    expect(descripcion('powerade_iniciar')).toMatch(/primero/i);
    expect(descripcion('powerade_publicar')).toMatch(/último|ultima|última/i);
  });

  it('powerade_iniciar delega en el servicio con el tournamentId y devuelve el briefing', async () => {
    const servicio = servicioFalso();
    const client = await conectar(servicio);

    const resultado = await client.callTool({ name: 'powerade_iniciar', arguments: { tournamentId: 6 } });

    expect(servicio.iniciar).toHaveBeenCalledWith(6);
    const texto = (resultado.content as Array<{ text: string }>)[0].text;
    expect(JSON.parse(texto)).toEqual({ draftId: 'abc', torneo: { nombre: 'T' } });
  });

  it('powerade_iniciar sin argumentos llama con undefined (el torneo en juego)', async () => {
    const servicio = servicioFalso();
    const client = await conectar(servicio);

    await client.callTool({ name: 'powerade_iniciar', arguments: {} });

    expect(servicio.iniciar).toHaveBeenCalledWith(undefined);
  });

  it('powerade_material delega con draftId, parte y desdeMatchId', async () => {
    const servicio = servicioFalso();
    const client = await conectar(servicio);

    const resultado = await client.callTool({
      name: 'powerade_material',
      arguments: { draftId: 'abc', parte: 'historial', desdeMatchId: 3 },
    });

    expect(servicio.material).toHaveBeenCalledWith('abc', 'historial', 3);
    expect((resultado.content as Array<{ text: string }>)[0].text).toBe('[{"matchId":1}]');
  });

  it('powerade_publicar delega con el draftId y el top3 tal cual', async () => {
    const servicio = servicioFalso();
    const client = await conectar(servicio);
    const top3 = [
      { playerId: 10, razon: 'Primera.' },
      { playerId: 20, razon: 'Segundo.' },
      { playerId: 30, razon: 'Tercera.' },
    ];

    await client.callTool({ name: 'powerade_publicar', arguments: { draftId: 'abc', top3 } });

    expect(servicio.publicar).toHaveBeenCalledWith('abc', top3);
  });

  it('un error de negocio vuelve como error de herramienta con su mensaje (y no como una falla del protocolo)', async () => {
    const servicio = servicioFalso();
    servicio.publicar.mockRejectedValue(new PoweradeMcpError('Corregí la frase del puesto 2.'));
    const client = await conectar(servicio);

    const resultado = await client.callTool({
      name: 'powerade_publicar',
      arguments: { draftId: 'abc', top3: [] },
    });

    expect(resultado.isError).toBe(true);
    expect((resultado.content as Array<{ text: string }>)[0].text).toBe('Corregí la frase del puesto 2.');
  });
});
