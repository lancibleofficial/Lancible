// Живые часы идущей задачи в мете строки (TaskRow, TaskListItem): ЧЧ:ММ:СС
// набранного по задаче времени вместе с идущим сеансом — то же число, что на
// плашке таймера (TimerMiniPlayer).
//
// Тикер живёт здесь, а не в строке: перерисовка раз в секунду касается одного
// Text, а не строки и не списка вокруг неё (так же устроены RunClock в шапке
// задачи и RunningTime на карточке доски).
import Text from './AppText';
import { useTicker } from '../hooks/useTicker';
import { fmtClock, taskElapsedMs } from '../lib/format';

export default function RunningClock({ task, activeTimer, style, testID }) {
  useTicker(true);
  return <Text style={style} numberOfLines={1} testID={testID}>{fmtClock(taskElapsedMs(task, activeTimer))}</Text>;
}
