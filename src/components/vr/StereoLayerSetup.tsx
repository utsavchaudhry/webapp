import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import type * as THREE from 'three'

// Tells the WebXR sub-cameras which extra layer each eye is allowed to see.
// Default behavior is "every camera sees layer 0", so meshes on layer 0
// render to both eyes (good for the grid, controllers, etc.). We add:
//   * left sub-camera → also sees layer 1
//   * right sub-camera → also sees layer 2
// VideoPlane's per-eye meshes sit on layers 1 and 2 respectively, so each
// half of the SBS stream renders to only one eye — proper stereo.
export function StereoLayerSetup() {
  const { gl } = useThree()

  useEffect(() => {
    const xr = gl.xr
    if (!xr) return

    const apply = () => {
      const arrayCam = xr.getCamera() as THREE.ArrayCamera | undefined
      // ArrayCamera.cameras: subcameras; cameras[0] = left, cameras[1] = right
      const subs = arrayCam?.cameras
      if (!subs || subs.length < 2) return
      subs[0].layers.enable(1)
      subs[1].layers.enable(2)
    }

    xr.addEventListener('sessionstart', apply)
    // If session is already live by the time we mount, apply right away.
    if (xr.isPresenting) apply()
    return () => xr.removeEventListener('sessionstart', apply)
  }, [gl])

  return null
}
