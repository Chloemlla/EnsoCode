export interface ComputerWindowInfo {
  id: string;
  app: string;
  title: string;
  pid?: number;
  x: number;
  y: number;
  width: number;
  height: number;
  focused?: boolean;
}

export interface ComputerDisplayInfo {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor?: number;
}

export type ComputerPermissionState = 'granted' | 'denied' | 'unknown' | 'unsupported';

export interface ComputerCapabilities {
  platform: string;
  capture: boolean;
  input: boolean;
  ax: boolean;
  backgroundInput: boolean;
  clipboard: boolean;
  capturePermission: ComputerPermissionState;
  inputPermission: ComputerPermissionState;
  axPermission: ComputerPermissionState;
  detail?: string;
}

export interface ComputerScreenshot {
  mimeType: 'image/png';
  data: string;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  target: string;
  silent?: boolean;
}

export interface ComputerRunResult {
  text: string;
  returnValue?: unknown;
  screenshots: ComputerScreenshot[];
  capabilities: ComputerCapabilities;
}
