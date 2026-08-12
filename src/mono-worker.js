// mono-worker.js — Worker: runs word solver on an assembled monument grid.
import { parentPort, workerData } from 'node:worker_threads';
import { solve } from './solver.js';

const { assembled, opts } = workerData;
const result = solve(assembled, opts);
parentPort.postMessage(result);
