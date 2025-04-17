// 远程浏览器选项接口
export interface RemoteBrowserOptions {
  headless?: boolean;
  slowMo?: number;
  devtools?: boolean;
  proxy?: {
    server: string;
    username?: string;
    password?: string;
  };
  userDataDir?: string;
}

// 解释器设置接口
export interface InterpreterSettings {
  debug: boolean;
  maxConcurrency: number;
  maxRepeats: number;
  params?: {
    [key: string]: any;
  };
}

// 动作类型枚举
export enum ActionType {
  Click = 'click',
  Type = 'type',
  KeyPress = 'keyPress',
  Navigate = 'navigate',
  DateSelection = 'dateSelection',
  DropdownSelection = 'dropdownSelection',
  TimeSelection = 'timeSelection',
  DateTimeLocalSelection = 'dateTimeLocalSelection',
  GoBack = 'goBack',
  GoForward = 'goForward',
  CustomAction = 'customAction',
  Keydown = 'keydown'
}

// 标签名枚举
export enum TagName {
  Input = 'INPUT',
  Button = 'BUTTON',
  Select = 'SELECT',
  Textarea = 'TEXTAREA',
  A = 'A',
  Div = 'DIV',
  Span = 'SPAN',
  P = 'P',
  H1 = 'H1',
  H2 = 'H2',
  H3 = 'H3',
  H4 = 'H4',
  H5 = 'H5',
  H6 = 'H6',
  Li = 'LI',
  Ul = 'UL',
  Ol = 'OL',
  Table = 'TABLE',
  Tr = 'TR',
  Td = 'TD',
  Th = 'TH',
  Form = 'FORM',
  Label = 'LABEL',
  Img = 'IMG'
}

// 动作接口
export interface Action {
  action: string;
  args: any[];
}

// 坐标接口
export interface Coordinates {
  x: number;
  y: number;
}

// 滚动增量接口
export interface ScrollDeltas {
  deltaX: number;
  deltaY: number;
}

// 键盘输入接口
export interface KeyboardInput {
  key: string;
  coordinates?: Coordinates;
}

// 日期选择器事件数据接口
export interface DatePickerEventData {
  selector: string;
  value: string;
} 