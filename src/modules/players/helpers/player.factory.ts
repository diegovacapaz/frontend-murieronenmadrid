import { Player } from '../entities/player.entity';
import { PlayerDB } from '../interfaces/database';

/**
 * Convierte filas crudas (`PlayerDB`) en instancias del modelo de dominio.
 *
 * Es el unico lugar donde una fila de MySQL se vuelve un Player: fuera del
 * repository nadie ve un RowDataPacket.
 */
export class PlayerFactory {
  static toObject(db: PlayerDB): Player {
    const player = new Player();
    player.playerId = db.playerId;
    player.firstName = db.firstName;
    player.secondName = db.secondName;
    player.nickname = db.nickname;
    player.displayName = db.displayName;
    player.photo = db.photo;
    player.state = db.state;
    player.isSagrado = db.isSagrado;
    player.createdAt = db.createdAt;
    player.cups = db.cups;
    // Defensa por si la columna JSON llega null (jugador sin titulos en una
    // consulta que no pase por el COALESCE de la vista).
    player.championships = db.championships ?? [];
    return player;
  }

  static toList(dbs: PlayerDB[]): Player[] {
    return dbs.map((db) => PlayerFactory.toObject(db));
  }
}
