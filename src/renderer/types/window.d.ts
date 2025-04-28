import { SystemBridge } from '../../main/bridge/types';

declare global {
  interface Window {
    system: SystemBridge;
  }
} 