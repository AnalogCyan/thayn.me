document.addEventListener('DOMContentLoaded', () => {
  const profilePic = document.querySelector('.profile-pic');

  // Check if it's a mobile device
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  let isDangling = false;
  let currentAngle = 0;
  let currentVelocity = 0;
  let animationFrame;

  // Physics constants
  const GRAVITY = 0.2;
  const DAMPING = 0.98;
  const SPRING = 0.01;
  const REST_ANGLE = 15; // Final resting angle
  const HOVER_SWING = 3; // Degrees to swing on hover when dangling

  // Update physics simulation
  function updatePhysics() {
    if (!isDangling) return;

    // Calculate forces
    const angleFromRest = currentAngle - REST_ANGLE;
    const springForce = -SPRING * angleFromRest;

    // Update velocity and position
    currentVelocity += springForce;
    currentVelocity *= DAMPING;
    currentAngle += currentVelocity;

    // Apply transform
    profilePic.style.transform = `rotate(${currentAngle}deg)`;

    // Stop animation if movement is very small
    if (Math.abs(currentVelocity) > 0.001 || Math.abs(angleFromRest) > 0.001) {
      animationFrame = requestAnimationFrame(updatePhysics);
    }
  }

  // Handle click to start dangling
  profilePic.addEventListener('click', () => {
    if (isMobile) return; // Disable on mobile devices

    if (isDangling) return;

    isDangling = true;
    profilePic.classList.add('dangling');

    // Initial "drop" animation
    currentAngle = 0;
    currentVelocity = GRAVITY * 20; // Initial push

    updatePhysics();
  });

  // Handle hover when dangling
  profilePic.addEventListener('mouseenter', () => {
    if (isMobile) return; // Disable on mobile devices

    if (!isDangling) return;

    // Add a small impulse to create a swinging effect
    currentVelocity += (Math.random() * 2 - 1) * HOVER_SWING;

    if (!animationFrame) {
      updatePhysics();
    }
  });

  // Reset on double click
  profilePic.addEventListener('dblclick', () => {
    if (isMobile) return; // Disable on mobile devices

    if (!isDangling) return;

    isDangling = false;
    profilePic.classList.remove('dangling');
    profilePic.style.transform = '';
    cancelAnimationFrame(animationFrame);
  });
});