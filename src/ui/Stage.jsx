import Gallery from './Gallery';
import Spotlight from './Spotlight';

export default function Stage(props) {
  return props.cstate.mode === 'ceremony' ? <Spotlight {...props} /> : <Gallery {...props} />;
}
