import React from 'react';
import {Composition} from 'remotion';
import {ReelEdit, reelEditSchema} from './ReelEdit';
import editPlan from './edit-plan.json';
import editPlanClean994 from './edit-plan-clean994.json';

const compFor = (id: string, plan: any) => (
  <Composition
    id={id}
    component={ReelEdit}
    durationInFrames={Math.max(30, Math.round(plan.totalDurationSec * plan.fps))}
    fps={plan.fps}
    width={plan.width}
    height={plan.height}
    schema={reelEditSchema}
    defaultProps={{plan}}
  />
);

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {compFor('ReelEdit', editPlan)}
      {compFor('Clean994', editPlanClean994)}
    </>
  );
};
