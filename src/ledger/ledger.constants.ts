/** TigerBeetle account `code`: what kind of account this is. */
export enum AccountCode {
  USER = 100,
  TREASURY = 200,
  FX_POOL = 300,
  FEE = 400,
}

/** TigerBeetle transfer `code`: why money moved. */
export enum TransferCode {
  DEPOSIT = 1,
  SWAP = 2,
  TRANSFER = 3,
  FX_FEE = 4,
}

export const TIGERBEETLE_CLIENT = Symbol('TIGERBEETLE_CLIENT');
