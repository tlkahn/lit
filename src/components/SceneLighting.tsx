export interface SceneLightingProps {
  isDark: boolean;
}

export function SceneLighting({ isDark }: SceneLightingProps) {
  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight intensity={1.0} position={[5, 10, 7]} />
      <hemisphereLight
        args={[
          isDark ? "#1a1a2e" : "#b1e1ff",
          isDark ? "#0a0a0a" : "#b97a20",
          0.5,
        ]}
      />
    </>
  );
}
